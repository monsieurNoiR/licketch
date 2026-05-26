# Licketch — CLAUDE.md

ギタープレイヤー向けフレーズメモ PWA（iPad Safari メイン）。
録音 → 無音検出でセグメント分割 → 波形確認・トリム → IndexedDB に AAC/M4A 保存。

## 起動方法

```bash
node server.js   # HTTPS on port 3443（mkcert 証明書使用）
```

iPad から `https://192.168.1.7:3443` でアクセス。

## 技術スタック

- **録音**: MediaRecorder API（mimeType フォールバック: webm → mp4）
- **無音検出**: Web Audio API AnalyserNode、RMS ウィンドウ（20ms×3連続 = 60ms 持続、-45dB 閾値）
- **波形**: Canvas 2D（`waveform.js`）、トリムハンドルのタッチ/マウスドラッグ対応
- **エンコード**: `createMediaStreamDestination()` + `MediaRecorder` でリアルタイム AAC/M4A 変換（`encodeAAC()`）。mimeType: `audio/mp4` → `audio/webm` フォールバック
- **ストレージ**: IndexedDB（AAC/M4A blob + draft）＋ localStorage（メタデータ）
- **PWA**: Service Worker キャッシュファースト、manifest.json

## ファイル構成

```
js/
  app.js       メインロジック・画面制御・タブバー
  recorder.js  MediaRecorder ラッパー
  analyzer.js  無音検出・レベルメーター
  waveform.js  Canvas 波形描画・トリム操作
  storage.js   IndexedDB (phrases / draft) ＋ localStorage
css/style.css
index.html     録音・波形確認・一覧・ヘルプの4画面＋タブバー
sw.js          Service Worker
server.js      Node.js HTTPS サーバー（開発用）
```

## 現在の状態（最終更新: 2026-05-26）

Phase 1〜3 実装完了・動作確認済み。ヘルプ画面追加済み。
AACエンコード中のプログレスバー追加済み。

### 実装済み機能

- **録音画面**: REC ボタン、経過時間表示、音量メーター、MARK ログ
- **波形確認画面**: 全録音の波形表示、セグメントナビ（前へ/次へ/完了）、トリムハンドル、プレビュー再生、AAC/M4A 保存
- **一覧画面**: フレーズ一覧、再生、ダウンロード、長押し個別削除、選択モード一括削除
- **ヘルプ画面**: 基本的な使い方・PWA インストール手順（iOS/Android 別）・オーディオインターフェース接続・FAQ（アコーディオン形式）
- **タブバー**: 全画面共通ナビ（録音/波形/一覧/？）。波形タブは録音データがある場合のみ有効
- **draft 復元**: 録音停止時に blob＋marks を IndexedDB の `draft` ストアへ保存。起動時に未処理の録音があれば復元確認ダイアログを表示

### IndexedDB スキーマ

- DB 名: `licketch`、バージョン: **2**
- ストア `phrases`: `{ id, blob }` — 保存済み AAC/M4A（旧データは WAV の場合もあり）
- ストア `draft`: `{ id: 'current', blob, marks }` — 未処理録音

### 既知の制約

- iPad Safari では `getUserMedia` の許可がページリロードごとにリセットされる（Safari の仕様）。ホーム画面への追加（PWA モード）で緩和可能
- mkcert の root CA を iPad にインストール＋「証明書信頼設定」で完全信頼を有効化しておく必要あり

## 注意点

- `waveform.load()` は `canvas.clientWidth/Height` を読むため、**スクリーンを `display:flex` にしてから呼ぶ**こと（`enterReviewScreen` で `showScreen('review')` を先に呼ぶ順序を守る）
- `findSoundStart()` は音未検出時に `null` を返す。セグメントの `hasSound` フラグで無音セグメントをフィルタリングしている
- `playPreview()` は `audioContext.state === 'suspended'` の場合に `resume()` してから再生（iOS draft 復元後に必要）
