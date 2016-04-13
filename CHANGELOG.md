# Change Log

## [1.0.0] - 2016-04-13
### Changed
- **MAJOR**: `key` and `filename` functions should return a Promise
- If `filename` is not provided, but `mode` is, use the key's filename
- Update npm dependencies
- Use eslint rules from airbnb/base

### Added
- `bucket` can now also be a function (which should return a Promise)
- Use `s3Params` to pass additional options to the S3 constructor
- Tests

[1.0.0]: https://github.com/bjyoungblood/hapi-serve-s3/compare/v0.1.1...v1.0.0
