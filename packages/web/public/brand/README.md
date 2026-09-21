# Tandry brand marks

`avatar.svg` is the canonical square avatar: the brand mark on the `#131821` tile,
sized to 56% of the frame so it stays legible at 20px. Platforms apply their own
corner rounding, so the source is full-bleed and square.

Used for the GitHub organisation avatar, which is what the `tandryio/tandry` repository
page shows. Re-export with any SVG rasteriser at 512x512; GitHub accepts up to 1MB.

npm is not covered by this file: npm renders the organisation's Gravatar rather than an
uploaded image, so changing it means setting a Gravatar for the org's email address.

Other Tandry marks in this directory tree:

- `../logo.svg`: the bare mark, 48x48, transparent. Rendered by `BrandMark` in the header.
- `../favicon.svg`: the same mark on a rounded `#131821` tile, 64x64. Linked from `root.tsx`.

The repository README shows `.github/assets/logo.svg`: `avatar.svg` with the corner
rounding GitHub applies to the organisation avatar, so both marks on the repository page
match.

All of them share one geometry; edit `logo.svg` first and mirror the paths into the others.

Third-party host marks live in `../hosts/` and `../host-icons/` and are not Tandry
branding. See `../host-icons/README.md` for their provenance.
