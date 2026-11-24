use super::*;

/// `Map.prototype.set` on a key that is present replaces the value and keeps the key's place;
/// the order of a new key is its first insertion. Expected value: a gjs `Map` set `a`, `b`, `a`, `c`
/// iterates as a, b, c with a's value the second one.
#[test]
fn inserting_a_present_key_replaces_its_value_and_keeps_its_place() {
    let mut map = InsertionOrderedMap::new();
    map.insert("a", 1);
    map.insert("b", 2);
    map.insert("a", 3);
    map.insert("c", 4);
    let entries: Vec<(&str, i32)> = map.iter().map(|(key, value)| (key, *value)).collect();
    assert_eq!(entries, [("a", 3), ("b", 2), ("c", 4)]);
    assert_eq!(map.get("b"), Some(&2));
    assert_eq!(map.get("missing"), None);
    assert!(!map.is_empty());
}
