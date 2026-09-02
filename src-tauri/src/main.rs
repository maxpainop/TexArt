// keeps the spare console out of release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    texart_lib::run()
}
