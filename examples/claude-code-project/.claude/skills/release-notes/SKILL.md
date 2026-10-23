---
name: release-notes
description: Draft release notes from merged pull requests since the last tag. Use when asked to prepare a release.
---

# Release notes

1. Find the last tag with `git describe --tags --abbrev=0`.
2. List commits since that tag with `git log <tag>..HEAD --oneline`.
3. Group them into Added, Changed, Fixed.
4. Follow the template in [template.md](template.md).
