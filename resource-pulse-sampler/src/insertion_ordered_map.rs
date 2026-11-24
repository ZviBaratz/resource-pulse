//! An insertion-ordered map, which gives the ranking the iteration order of a JavaScript `Map`.

use std::collections::HashMap;

/// A map from text to a value that iterates in the order keys were first inserted, as a JavaScript
/// `Map` does: inserting a key that is present replaces its value and keeps its place.
#[derive(Debug, Clone)]
pub struct InsertionOrderedMap<Value> {
    entries: Vec<(String, Value)>,
    position_by_key: HashMap<String, usize>,
}

impl<Value> Default for InsertionOrderedMap<Value> {
    /// An empty map.
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            position_by_key: HashMap::new(),
        }
    }
}

impl<Value> InsertionOrderedMap<Value> {
    /// An empty map.
    pub fn new() -> Self {
        Self::default()
    }

    /// `map.set(key, value)`.
    pub fn insert(&mut self, key: &str, value: Value) {
        match self.position_by_key.get(key) {
            Some(&position) => {
                if let Some(entry) = self.entries.get_mut(position) {
                    entry.1 = value;
                }
            }
            None => {
                self.position_by_key
                    .insert(key.to_string(), self.entries.len());
                self.entries.push((key.to_string(), value));
            }
        }
    }

    /// `map.get(key)`, `None` for `undefined`.
    pub fn get(&self, key: &str) -> Option<&Value> {
        let position = *self.position_by_key.get(key)?;
        self.entries.get(position).map(|(_, value)| value)
    }

    /// `map.get(key)` for a value that is changed in place.
    pub(crate) fn get_mut(&mut self, key: &str) -> Option<&mut Value> {
        let position = *self.position_by_key.get(key)?;
        self.entries.get_mut(position).map(|(_, value)| value)
    }

    /// The values in insertion order.
    pub(crate) fn values(&self) -> impl Iterator<Item = &Value> {
        self.entries.iter().map(|(_, value)| value)
    }

    /// The entries in insertion order.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &Value)> {
        self.entries
            .iter()
            .map(|(key, value)| (key.as_str(), value))
    }

    /// `map.size === 0`.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[cfg(test)]
mod tests;
