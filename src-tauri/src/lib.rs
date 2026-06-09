mod commands;
mod db;
mod state;
mod vault;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::new())
        .setup(|_app| {
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Vault
            commands::vault_cmd::vault_select,
            commands::vault_cmd::vault_get_path,
            commands::vault_cmd::vault_get_saved_path,
            commands::vault_cmd::vault_init,
            commands::vault_cmd::vault_tree,
            commands::vault_cmd::vault_move,
            commands::vault_cmd::vault_create_folder,
            commands::vault_cmd::vault_delete_item,
            commands::vault_cmd::vault_open_in_explorer,
            // Notes
            commands::notes::notes_list,
            commands::notes::notes_read,
            commands::notes::notes_write,
            commands::notes::notes_create,
            commands::notes::notes_delete,
            commands::notes::notes_rename,
            commands::notes::notes_recent,
            commands::notes::notes_tags,
            commands::notes::notes_by_tag,
            commands::notes::notes_set_archived,
            commands::notes::notes_set_pinned,
            commands::notes::notes_batch_archive,
            commands::notes::notes_batch_delete,
            commands::notes::notes_batch_tag,
            commands::notes::notes_update_links,
            commands::notes::notes_backlinks,
            commands::notes::notes_forward_links,
            commands::notes::notes_stats,
            // Tags
            commands::notes::tags_rename,
            commands::notes::tags_delete,
            // Diary
            commands::diary::diary_get,
            commands::diary::diary_create,
            commands::diary::diary_get_month,
            commands::diary::diary_get_range,
            commands::diary::diary_sync_from_page,
            commands::diary::diary_sync_to_page,
            // Todos
            commands::todos::todos_list,
            commands::todos::todos_toggle,
            commands::todos::todos_add,
            commands::todos::todos_delete,
            commands::todos::todos_update_deadline,
            commands::todos::todos_sync_all,
            commands::todos::todos_extract,
            // Todo Page
            commands::todos::todo_page_list,
            commands::todos::todo_page_add,
            commands::todos::todo_page_delete,
            commands::todos::todo_page_toggle,
            // DDL
            commands::todos::ddl_list,
            commands::todos::ddl_add,
            commands::todos::ddl_delete,
            // Search
            commands::search::search_query,
            commands::search::search_reindex,
            // Git
            commands::git::git_status,
            commands::git::git_pull,
            commands::git::git_push,
            // Export
            commands::export::export_pdf,
            commands::export::export_markdown_to_html,
            // Assets & PDF
            commands::assets::assets_save_image,
            commands::assets::assets_read_data_url,
            commands::assets::pdf_read,
            commands::assets::pdf_read_annotations,
            commands::assets::pdf_write_annotations,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
