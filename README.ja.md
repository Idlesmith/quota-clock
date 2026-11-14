# quota-clock

[English](./README.md)

Claude や Codex などの AI サービスごとに、5時間枠や週間枠のリセット時刻・残量メモを記録し、「次に使えるのはいつか」を残り時間の短い順で一覧表示する、外部依存なしの Node.js 製 CLI & ライブラリです。

## 特徴

- 複数の AI サービスと使用枠（`5h`、`weekly`、または任意の枠名）を一元管理
- 柔軟な時刻指定：相対時間（`155m`、`2h30m`、`3d`、`+155`）、ローカル時刻（`00:50`、`13:05`）、ISO 8601 形式に対応
- 周期枠の自動繰り上げ計算（`5h` = 300分、`weekly` = 10080分、または `--period` で任意指定）
- 外部パッケージ依存なし（Node.js 20 以降）、ローカルの JSON ファイルに安全に保存

## 導入（インストール）

ソースを取得した場合は、依存パッケージをインストールせずに実行できます：

```bash
node bin/quota-clock.mjs help
npm test
```

ローカルのソースを `quota-clock` コマンドとして登録するには `npm link` を実行します。

グローバルにインストールする場合：

```bash
npm i -g quota-clock
```

インストールせずに `npx` で直接実行する場合：

```bash
npx quota-clock help
```

## CLI の使い方

```text
quota-clock set <service> <window> <when> [--note text] [--period minutes]
quota-clock list [--json]
quota-clock rm <service> [window]
quota-clock help
```

`list` はサービス・枠・ローカル時刻での次回リセット・残り時間・メモを表示します。周期のない枠でリセット時刻を過ぎたものは「今使える」と表示し、周期枠は次回リセットへ繰り上げます。`list --json` は ISO 日時と残りミリ秒を含むライブラリの一覧データを返します。

### `<when>`（リセット時刻）の指定形式

- 相対時間：`155m`、`2h30m`、`3d`、`+155`（分単位）
- ローカル時刻（`HH:MM`）：`00:50`、`13:05`（当日、すでに過ぎていれば翌日のその時刻）
- ISO 8601 日時：例 `2026-11-14T15:00:00Z`

### `<window>`（枠名）の既定周期

- `5h`：既定で 300分（5時間）周期として次回リセット時刻を繰り上げ計算します
- `weekly`：既定で 10080分（7日間）周期として計算します
- 任意の枠名も指定可能です（必要に応じて `--period <minutes>` で周期を指定）

### 実行例

```bash
# Claude の 5時間枠が 2時間35分後にリセットされることを記録
quota-clock set claude 5h 2h35m --note "Opus 集中利用後"

# Codex の週間枠が 155分後にリセットされることを残量メモ付きで記録
quota-clock set codex weekly 155m --note "残り20%"

# ローカル時刻 00:50 のリセットを記録
quota-clock set claude 5h 00:50

# 残り時間が短い順で一覧表示
quota-clock list

# JSON 形式で出力
quota-clock list --json

# 特定の枠、またはサービス全体を削除
quota-clock rm claude 5h
quota-clock rm codex
```

## データの保存場所

データは以下の優先順位で決定されるディレクトリ内の `data.json` に保存されます：

1. 環境変数 `QUOTA_CLOCK_HOME`（設定されている場合）
2. Windows：`%APPDATA%\quota-clock`
3. Linux / macOS：`$XDG_CONFIG_HOME/quota-clock`（未設定時は `~/.config/quota-clock`）

## ライブラリ API

```js
import { createClock } from 'quota-clock';

const clock = createClock({
  // 省略可：保存先ディレクトリと現在時刻関数の差し替え
  // home: '/path/to/dir',
  // now: () => new Date(),
});

// リセット時刻を記録
clock.set('claude', '5h', '155m', {
  note: '残りわずか',
  // periodMinutes: 300, // '5h' は 300、'weekly' は 10080 が既定
});

// 残り時間が短い順で一覧を取得
const entries = clock.list();
// => [{ service: 'claude', window: '5h', nextResetAt: '...', remainingMs: 9300000, note: '残りわずか' }]

// 特定の枠またはサービス全体を削除
clock.remove('claude', '5h');
clock.remove('claude');
```

## ライセンス

MIT
