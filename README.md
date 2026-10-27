# rss

Personal RSS: ORIGINALS Podcasts and Cello Music feeds.

### ⚠️ cloning

Folders `Podcasts/` y `Musica/` are **not required in local**. Apply *sparse-checkout* configuration when cloning:

```bash
git clone --filter=blob:none --sparse https://github.com/zokosting/rss.git
cd rss
git sparse-checkout set --no-cone '/*' '!/Podcasts/' '!/Musica/'
```
