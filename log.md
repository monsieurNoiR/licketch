# Licketch 変更ログ

## 2026-05-26

### AACエンコード中のプログレスバー追加

- `index.html`: `.encode-progress` ブロック（トラック＋フィル＋ラベル）を波形確認画面に追加（`phrase-actions` の直上）
- `css/style.css`: `.encode-progress` / `.encode-progress-track` / `.encode-progress-fill` / `.encode-progress-label` スタイルを追加
- `js/app.js`:
  - `encodeAAC()` に `onStarted` コールバック引数を追加。`src.start()` 直前に `audioContext.currentTime` を渡す
  - `btnSave` クリックハンドラーを更新：エンコード中はプログレスバーを表示し `requestAnimationFrame` で進捗を更新。完了時に100%→200ms後に非表示
  - エンコード中は `btnPrev` / `btnNext` / `btnPlay` も `disabled` にして誤操作を防止
