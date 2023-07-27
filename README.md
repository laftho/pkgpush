# pkgpush

A simple utility to help bulk restore package dependencies from your local copy.

### Install
```bash
npm install -g pkgpush
```

### Example

Note: `pkgpush` without `--s3` or `--publish` will only create `npm pack` tarballs in your current working directory.

```bash
pkgpush --filter @myorg
```

### Options:
- `--filter` - package prefix filter
- `--s3` - destination s3 bucket name, assumes you have the aws cli installed
- `--publish` - publish the package via `npm publish --ignore-scripts`
