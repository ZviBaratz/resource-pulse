// gnome-shell/tests/nested/systemdStandIn.js
// ===========================================
// systemd's user manager as a default install with no cockpit answers the extension, for a nested run started with
// --no-cockpit. The run's private session bus has no systemd, so without this the cockpit client's StartUnit fails
// (NameHasNoOwner) and it keeps retrying (5, 30, 300 s, then every 300 s), which a default install never does.
//
// A default install links both units (README's install steps) and writes no ~/.config/resource-pulse/cockpit.json,
// which is opt-in. systemd then accepts StartUnit for either unit; it skips the cockpit's start job on its
// ConditionPathExists, and the unit stays loaded with ConditionResult false, checked by that job. The cockpit
// client reads that after its confirmation wait and is skipped: no retry (cockpitClient.js, case "ConditionResult
// false, checked"). The sampler's StartUnit is accepted too; the nested run's sampler is already on the bus.
//
// Only what the extension calls is served: Manager.StartUnit and Manager.GetUnit, and the cockpit unit's three
// properties the client reads. Any other unit is NoSuchUnit, as systemd answers for a unit it has no file for.
// systemd-stand-in.js serves this on the run's private bus; the cockpit client's D-Bus rows serve it on theirs.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const SYSTEMD_BUS_NAME = 'org.freedesktop.systemd1';
export const SYSTEMD_MANAGER_OBJECT_PATH = '/org/freedesktop/systemd1';
const SYSTEMD_MANAGER_INTERFACE_NAME = 'org.freedesktop.systemd1.Manager';
const SYSTEMD_UNIT_INTERFACE_NAME = 'org.freedesktop.systemd1.Unit';
export const COCKPIT_UNIT_NAME = 'resource-pulse-cockpit.service';
export const SAMPLER_UNIT_NAME = 'resource-pulse.service';
/** The cockpit unit's object, its name escaped as systemd escapes it ('-' is _2d, '.' is _2e). */
export const COCKPIT_UNIT_OBJECT_PATH = '/org/freedesktop/systemd1/unit/resource_2dpulse_2dcockpit_2eservice';
const JOB_OBJECT_PATH_PREFIX = '/org/freedesktop/systemd1/job/';
export const NO_SUCH_UNIT_ERROR_NAME = 'org.freedesktop.systemd1.NoSuchUnit';
/** The units a default install links: StartUnit accepts a job for these and no other. */
const LINKED_UNIT_NAMES = Object.freeze([SAMPLER_UNIT_NAME, COCKPIT_UNIT_NAME]);
/** A skipped unit's state: its start job ran, found the condition false, and left it inactive. */
const SKIPPED_UNIT_ACTIVE_STATE = 'inactive';
/** StartUnit's and GetUnit's reply as a GLib.Variant type: one object path. */
const OBJECT_PATH_REPLY_SIGNATURE = '(o)';
/** wrapJSObject calls <Method><suffix>(parameters, invocation) for a method it finds no plain handler for. */
const INVOCATION_HANDLER_SUFFIX = 'Async';

/** systemd's Manager as the extension calls it: StartUnit and GetUnit. */
const SYSTEMD_MANAGER_INTERFACE_XML = `<node>
  <interface name="${SYSTEMD_MANAGER_INTERFACE_NAME}">
    <method name="StartUnit">
      <arg name="name" type="s" direction="in"/>
      <arg name="mode" type="s" direction="in"/>
      <arg name="job" type="o" direction="out"/>
    </method>
    <method name="GetUnit">
      <arg name="name" type="s" direction="in"/>
      <arg name="unit" type="o" direction="out"/>
    </method>
  </interface>
</node>`;
/** The three properties of systemd's Unit interface the cockpit client reads, with systemd's types. */
const SYSTEMD_UNIT_INTERFACE_XML = `<node>
  <interface name="${SYSTEMD_UNIT_INTERFACE_NAME}">
    <property name="ConditionResult" type="b" access="read"/>
    <property name="ConditionTimestampMonotonic" type="t" access="read"/>
    <property name="ActiveState" type="s" access="read"/>
  </interface>
</node>`;

/**
 * The units as a default install with no cockpit.json has them: what StartUnit and GetUnit answer, and the cockpit
 * unit's properties. Pure but for the clock it is given.
 */
export class DefaultInstallUnits {
    /**
     * @param {() => number} monotonicTimeUsec - CLOCK_MONOTONIC in microseconds, as systemd stamps a condition check.
     */
    constructor(monotonicTimeUsec) {
        this._monotonicTimeUsec = monotonicTimeUsec;
        this._lastJobId = 0;
        // When the cockpit unit's last start job checked its condition; null until one ran (the unit not loaded).
        this._cockpitConditionCheckedUsec = null;
    }

    /**
     * StartUnit: a job for a linked unit (the cockpit's checks its condition at once, and is skipped); NoSuchUnit
     * for any other.
     *
     * @param {string} unitName - The unit asked for.
     * @returns {{jobObjectPath: string}|{errorName: string, message: string}} The reply, or the error.
     */
    startUnit(unitName) {
        if (!LINKED_UNIT_NAMES.includes(unitName))
            return {errorName: NO_SUCH_UNIT_ERROR_NAME, message: `Unit ${unitName} not found.`};
        if (unitName === COCKPIT_UNIT_NAME)
            this._cockpitConditionCheckedUsec = this._monotonicTimeUsec();
        this._lastJobId += 1;
        return {jobObjectPath: `${JOB_OBJECT_PATH_PREFIX}${this._lastJobId}`};
    }

    /**
     * GetUnit: the cockpit unit's object once a start job loaded it; NoSuchUnit before that, and for any other unit
     * (the extension asks GetUnit of the cockpit's alone).
     *
     * @param {string} unitName - The unit asked for.
     * @returns {{unitObjectPath: string}|{errorName: string, message: string}} The reply, or the error.
     */
    getUnit(unitName) {
        if (unitName === COCKPIT_UNIT_NAME && this._cockpitConditionCheckedUsec !== null)
            return {unitObjectPath: COCKPIT_UNIT_OBJECT_PATH};
        return {errorName: NO_SUCH_UNIT_ERROR_NAME, message: `Unit ${unitName} not loaded.`};
    }

    /**
     * The cockpit unit's properties: its condition false, checked by the last start job, and inactive.
     *
     * @returns {{ConditionResult: boolean, ConditionTimestampMonotonic: number, ActiveState: string}} Them.
     */
    cockpitUnitProperties() {
        return {
            ConditionResult: false,
            ConditionTimestampMonotonic: this._cockpitConditionCheckedUsec ?? 0,
            ActiveState: SKIPPED_UNIT_ACTIVE_STATE,
        };
    }
}

/**
 * Answers one method call with a reply DefaultInstallUnits gave: its object path, or its D-Bus error.
 *
 * @param {Gio.DBusMethodInvocation} invocation - The call.
 * @param {{jobObjectPath?: string, unitObjectPath?: string, errorName?: string, message?: string}} answer - The
 *     reply or the error.
 * @returns {void}
 */
function returnAnswer(invocation, answer) {
    if (answer.errorName !== undefined) {
        invocation.return_dbus_error(answer.errorName, answer.message);
        return;
    }
    const objectPath = answer.jobObjectPath ?? answer.unitObjectPath;
    invocation.return_value(new GLib.Variant(OBJECT_PATH_REPLY_SIGNATURE, [objectPath]));
}

/**
 * Exports a default install's systemd Manager and cockpit unit on a connection; owning the name is the caller's.
 *
 * @param {Gio.DBusConnection} connection - The bus to serve on: the run's private session bus, or a test's.
 * @param {DefaultInstallUnits} units - What the objects answer.
 * @returns {{unexport: () => void}} Takes both objects off the connection.
 * @throws {GLib.Error} When an object cannot be exported.
 */
export function exportDefaultInstallSystemd(connection, units) {
    const exportedManager = Gio.DBusExportedObject.wrapJSObject(SYSTEMD_MANAGER_INTERFACE_XML, {
        [`StartUnit${INVOCATION_HANDLER_SUFFIX}`]: ([unitName], invocation) =>
            returnAnswer(invocation, units.startUnit(unitName)),
        [`GetUnit${INVOCATION_HANDLER_SUFFIX}`]: ([unitName], invocation) =>
            returnAnswer(invocation, units.getUnit(unitName)),
    });
    // Read on each Properties.Get, so the condition's time is the last start job's.
    const exportedCockpitUnit = Gio.DBusExportedObject.wrapJSObject(SYSTEMD_UNIT_INTERFACE_XML, {
        get ConditionResult() {
            return units.cockpitUnitProperties().ConditionResult;
        },
        get ConditionTimestampMonotonic() {
            return units.cockpitUnitProperties().ConditionTimestampMonotonic;
        },
        get ActiveState() {
            return units.cockpitUnitProperties().ActiveState;
        },
    });
    exportedManager.export(connection, SYSTEMD_MANAGER_OBJECT_PATH);
    try {
        exportedCockpitUnit.export(connection, COCKPIT_UNIT_OBJECT_PATH);
    } catch (error) {
        exportedManager.unexport();
        throw error;
    }
    return {
        unexport: () => {
            exportedCockpitUnit.unexport();
            exportedManager.unexport();
        },
    };
}
