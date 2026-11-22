# 習慣トラッカー(PWA)の決まり

- データは localStorage(キー `habit-tracker:v1`)だけに保存する。外部のサーバーやサービスへ送らない。外部の CDN・ライブラリも使わない
- アプリのファイル(HTML / CSS / JS / manifest / アイコン)を変えたら、`sw.js` の `VERSION` を 1 つ上げる(`'v1'` → `'v2'`。キャッシュ名は `habit-tracker-v1` → `habit-tracker-v2` になる)。ファイルを増やしたら `sw.js` の `APP_FILES` にも足す。README やテストだけの変更なら上げなくてよい
- 確認は file:// ではなく、`habit-tracker` フォルダで `python -m http.server 8765 --bind 127.0.0.1` を実行して配信し、`http://127.0.0.1:8765/` で行う
- 画面に関係しない処理は `habits.js` に置き、変えたら `node --test` を通す
- 公開(push)の前に `node --test` と `python tools/check_site.py` を実行し、テスト全件成功・要確認 0 件を確かめる
