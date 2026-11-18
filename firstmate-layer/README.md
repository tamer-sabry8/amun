# Amun's Firstmate layer

`vendor/firstmate/` is an untouched `git subtree` of https://github.com/kunchenguid/firstmate.
Never edit files under it. Everything Amun adds for Firstmate lives here or in `packages/server/src/server/amun/`.

Update from upstream:

```sh
git subtree pull --prefix vendor/firstmate https://github.com/kunchenguid/firstmate main --squash
```

Check it is still pristine (prints nothing when clean):

```sh
scripts/check-firstmate-pristine.sh
```
