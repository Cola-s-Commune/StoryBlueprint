# Ink Node Conversion Profile

Story Blueprint treats Ink as an interoperability format, not as the primary authoring format.
Profile v1 converts only structures whose Story Graph meaning can be preserved without guessing.
When valid Ink falls outside this profile, import creates one embedded **Ink Block** containing the
complete original source. The block remains editable and runs through the full Ink runtime.

## Converted To Native Nodes

| Ink construct                                  | Story Graph result      | Notes                                                                                            |
| ---------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| `Character: dialogue`                          | Dialogue / Line         | Character name resolves to a project Character. Line metadata tags are retained where supported. |
| Bare output text or `Narrator: text`           | Narration               | Narration has text and an optional Voice Asset.                                                  |
| `* Choice -> knot`                             | Choice / Option         | Supports an optional simple visibility condition and a following-line divert.                    |
| `=== knot ===`, `-> knot`                      | Flow Anchor / Flow Jump | Anchors preserve non-linear graph flow.                                                          |
| `VAR name = literal`                           | Story Variable          | Only Boolean, Number, and quoted String defaults are imported.                                   |
| `~ variable = expression`                      | Set Variable            | Expressions stay textual and typed.                                                              |
| Simple `if / else` block                       | Branch                  | Exactly one divert in each arm.                                                                  |
| `EXTERNAL name(args)` with an explicit mapping | Call External Function  | Mapping and parameter types must agree with the project definition.                              |
| `-> END`, `-> DONE`                            | End / Return            | Converted as the matching terminal node.                                                         |

## Preserved As An Ink Block

These constructs are accepted only when the complete source compiles under the full Ink compiler.
They produce a warning explaining why node conversion was skipped; the import preview shows one
Ink Block instead of a partial native graph.

| Ink construct                                                                 | Reason                                                           |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Sticky choices (`+`)                                                          | Story Choice nodes do not model Ink's persistent choice state.   |
| `INCLUDE`, `LIST`, `CONST`, `TUNNEL`, `FUNCTION`                              | No lossless native node counterpart in Profile v1.               |
| Stitches and other `==` declarations                                          | Graph anchor semantics are not equivalent to Ink stitch scope.   |
| Unsupported `~` evaluation or control syntax                                  | It could alter Ink state beyond typed Story Variable assignment. |
| Conditionals with inline output, nested flow, or more than one divert per arm | A native Branch would change control flow.                       |
| Inline conditionals, sequences, alternatives                                  | A Text Template does not model Ink's visit and sequence state.   |
| Choice tags and narration emotion or ordinary tags                            | Native Choice and Narration nodes cannot retain their semantics. |

## Hard Errors

Import stops and does not create an Ink Block when the source cannot run as Ink or cannot be
resolved safely.

- Empty or syntactically invalid Ink source.
- Missing knots, malformed calls, or other Ink compiler errors.
- Unknown Character, Asset, Variable, External Function mapping, or typed expression errors in
  constructs that Profile v1 would otherwise convert.
- Incomplete native-profile control flow, such as a normal Choice without a target.

## Conversion Guarantees

- Native conversion is explicit and staged as a proposal; Apply and Discard leave the existing
  Story unchanged until the author decides.
- Ink Block fallback preserves the original source byte-for-byte after the file read. It never
  attempts a mixed partial conversion.
- Ink Block to Nodes also uses this profile. Unsupported valid source stays in its original Ink
  Block rather than being replaced with an incomplete graph.
- Profile behavior is versioned by `INK_NODE_PROFILE_VERSION`; later profiles may add native
  conversions without redefining Profile v1.
