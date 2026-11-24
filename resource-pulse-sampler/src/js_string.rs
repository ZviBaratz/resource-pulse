//! JavaScript's string semantics where the gjs sampler's app ranking depended
//! on them, which [`crate::apps`] keeps. A JavaScript string is a sequence of UTF-16 code units; a
//! Rust `str` is UTF-8 and orders by code point. The two orders differ for text outside the Basic
//! Multilingual Plane, so every comparison the gjs original made with `<`, `>` or the default
//! `sort()` goes through [`js_string_order`].

use std::cmp::Ordering;

/// Orders as JavaScript's default sort and its `<` do: by UTF-16 code unit.
pub fn js_string_order(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

/// `text.charAt(0).toUpperCase() + text.slice(1)`.
///
/// `charAt(0)` is the first UTF-16 code unit. Upper-casing a unit that is half of a surrogate pair
/// gives that unit back, so a first character outside the Basic Multilingual Plane is left as it
/// is, even when it has an upper case (U+10428 has U+10400); upper-casing a BMP character gives
/// what `toUpperCase` gives, which can be several characters (`ß` is `SS`).
pub fn capitalise_first_code_unit(text: &str) -> String {
    let mut characters = text.chars();
    let Some(first_character) = characters.next() else {
        return String::new();
    };
    let rest_of_text = characters.as_str();
    if first_character.len_utf16() > 1 {
        return text.to_string();
    }
    let upper_cased_first_character: String = first_character.to_uppercase().collect();
    format!("{upper_cased_first_character}{rest_of_text}")
}

#[cfg(test)]
mod tests;
