//! What the rows read of the cache that the program has no use for.

use super::AppNameCache;

impl AppNameCache {
    /// How many ids are cached, for the row that bounds it.
    pub(in crate::sampler) fn cached_desktop_id_count(&self) -> usize {
        self.app_name_by_desktop_id.len()
    }
}
