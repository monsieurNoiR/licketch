# Licketch 変更ログ

## 未対応の技術的負債（2026-05-26 時点）

### 中程度

- **`encodeAAC()` にタイムアウト処理がない** — MediaRecorder の `onstop` が発火しない場合、Promise が永久に resolve されず「保存中…」のまま固まる
- **`decodeAudioData` にエラーハンドリングがない** — `enterReviewScreen()` でのデコード失敗（破損データ等）が握りつぶされてフリーズする
- **`storage.savePhrase` の失敗がユーザーに伝わらない** — IndexedDB 書き込み失敗や `localStorage` の `QuotaExceededError` を catch しておらず、失敗しても「保存 ✓」と表示される
- **初期化 IIFE にエラーハンドリングがない** — `storage.init()` や `storage.getDraft()` の失敗が catch されず、アプリ全体が起動しなくなる
- **一覧画面の Object URL が再生停止時にリークする** — `toggleListPlay()` で生成した Object URL が `onended` 以外のパス（途中停止等）で `revokeObjectURL` されない

### 軽微

- **`getUserMedia` のエラーメッセージが汎用的すぎる** — `NotFoundError`（マイクなし）と `NotAllowedError`（権限拒否）で同じメッセージを表示する
- **`console.log` が本番コードに残っている** — `recorder.js`（2箇所）・`analyzer.js`（1箇所）
- **メタデータと blob の非同期性による孤立データの可能性** — IndexedDB 書き込み成功後・`localStorage` 書き込み前にクラッシュすると、参照されない blob が蓄積する
- **`Waveform` の `mousemove` / `mouseup` リスナーが `window` に残り続ける** — インスタンスが再作成される場合にリークするが、現状は1回のみ生成なので実害なし

---

## 2026-05-26 (4)

### GitHub Pages 公開対応

- `key.pem` / `cert.pem` は .gitignore 済み・git 履歴にも一度もコミットされていないことを確認（対応不要）
- `index.html`: `/icons/icon-192.png` → `icons/icon-192.png`、`/manifest.json` → `manifest.json`
- `js/app.js`: SW 登録パスを `/sw.js` → `sw.js`
- `sw.js`: SHELL の全パスを `/xxx` → `./xxx` に変更、navigate ハンドラも `/index.html` → `./index.html`
- `manifest.json`: `scope` / `start_url` を `"/"` → `"./"` に変更、アイコン src も `./icons/` に変更
- `sw.js`: キャッシュバージョンを v5 → v6 に更新（パス変更に伴うキャッシュ無効化）

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
