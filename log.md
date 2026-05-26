# Licketch 変更ログ

## 2026-05-26 (3)

### Service Worker キャッシュバージョンを v5 に更新

- `sw.js`: `licketch-v4` → `licketch-v5`

## 2026-05-26 (2)

### ヘルプ FAQ に「保存したファイルはどこに？」を追加

- `index.html`: よくある問題セクションに `<details>` 項目を追加
  - iPad/iPhone・Android 別のダウンロード先
  - アプリ内データ（IndexedDB）はファイルアプリから見えない旨
  - ↓ ボタンでのバックアップを推奨

## 2026-05-26 (1)

### AACエンコード中のプログレスバー追加

- `index.html`: `.encode-progress` ブロック（トラック＋フィル＋ラベル）を波形確認画面に追加（`phrase-actions` の直上）
- `css/style.css`: `.encode-progress` / `.encode-progress-track` / `.encode-progress-fill` / `.encode-progress-label` スタイルを追加
- `js/app.js`:
  - `encodeAAC()` に `onStarted` コールバック引数を追加。`src.start()` 直前に `audioContext.currentTime` を渡す
  - `btnSave` クリックハンドラーを更新：エンコード中はプログレスバーを表示し `requestAnimationFrame` で進捗を更新。完了時に100%→200ms後に非表示
  - エンコード中は `btnPrev` / `btnNext` / `btnPlay` も `disabled` にして誤操作を防止
