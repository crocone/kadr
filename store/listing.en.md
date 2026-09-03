# Chrome Web Store listing — English

## Name

Kadr — screenshots & step guides

## Short description (132 characters max)

Capture any page, beautify the shot, record a click-by-click guide, redact private data offline. No trial, no watermarks.

## Category

Workflow & Planning

## Single purpose

Capturing and presenting screenshots of web pages. Everything in the extension serves that
one purpose: the capture modes produce the shot, the editor dresses it, the library keeps
it, the guide recorder turns a run through an interface into numbered steps, and the
tracker integration delivers the result.

## Full description

**Take the shot.** The whole page stitched from frames, the visible area, a region you drag
with a pixel magnifier, or a DOM element picked by hovering it. A chat or an endless feed is
captured while it scrolls, stitched by content rather than coordinates, so inner scroll
containers work too. Hover a table and copy it as CSV, Markdown or JSON instead of a
picture. A responsive series shoots 375, 768 and 1440 px in one go and puts all three on
one canvas. A saved shot can be reshot from the same page at the same width with one click.

**Make it presentable.** Backgrounds drawn in code — gradients, patterns, solids — margins,
corner radius, shadows, real macOS and Windows 11 browser frames with an editable url,
device bodies, and a mockup of your own. Save the whole look as a style preset and share the
JSON with your team.

**Explain it.** Arrows in seven styles, numbered step badges, spotlight, highlighter, text
with your local fonts, shapes and callouts. Blur stays a layer you can move or remove later
instead of pixels burnt into the image.

**Turn clicks into a guide.** Press Record, walk through the interface, press Stop. Every
click becomes a step: a frame with the element outlined, a numbered badge and a caption like
"Click 'Save'" taken from the element's own label. Restyle the whole guide at once, redact
private data across every step offline, and export it as Markdown with images, a PDF or
one long image.

**Hide what should not be public.** Text recognition runs inside the browser — no key, no
server, no upload — and finds emails, phone numbers, cards, IBANs, IP addresses, JWTs and API keys for you to
cover with one click. Nothing is redacted without your confirmation, and nothing is ever a guarantee:
check the shot before you publish it.

**Send it where the work is.** A library with search by site, date, tag and the text
recognised on the shot. Copy as an image, as markdown or as a data URI. Export PNG, JPEG,
WebP or PDF. Or go straight to a GitHub, Linear or Jira issue with your own token — the
picture, the page url, the browser and the screen size come along.

**Bring your own AI, or none at all.** AI is off by default and makes no request until you
turn it on and enter a key. Write your own prompts and run them on the shot, or edit the
picture with words and get the result back as a layer. OpenAI, Anthropic, Google, a local
Ollama or LM Studio, or any OpenAI-compatible endpoint. The redaction pass above needs no
AI at all.

**No telemetry.** Not a line about you goes anywhere: no counters, no analytics, no
"anonymous statistics". The extension makes exactly three kinds of network request, all of
them started by you: an AI action with your key, a language pack download for offline text
recognition, and sending a shot to the tracker you configured.

Open source, MIT: <https://github.com/crocone/kadr>

## Honest limits

- Chrome limits tab capture to about two frames per second, so a long page takes a while.
- Browser pages, the Web Store and other extensions' pages cannot be captured — a platform
  rule, not a bug.
- Virtualised lists (react-window and friends) break stitching: the DOM does not physically
  hold the rows that are off screen.
- The responsive series really resizes the window, and that is visible while it runs.

## Permission justifications

| Permission                    | Why                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab`                   | Read the page being captured, at the moment the user starts a capture from the icon, menu or hotkey                                                                                                                                                                                         |
| `scripting`                   | Inject the capture overlay and the page-measuring script into that tab                                                                                                                                                                                                                      |
| `storage`, `unlimitedStorage` | Keep documents, shots and settings locally; screenshots are large and there are many                                                                                                                                                                                                        |
| `downloads`                   | Save the exported file                                                                                                                                                                                                                                                                      |
| `clipboardWrite`              | Copy the shot to the clipboard on the Copy button                                                                                                                                                                                                                                           |
| `contextMenus`                | The right-click entry points into capture                                                                                                                                                                                                                                                   |
| Host access (`<all_urls>`)    | Optional, one site at a time and always behind a button: reshooting a saved shot, recording a step guide across pages, and sending to the issue tracker the user configured — Linear additionally needs storage.googleapis.com, where its API hands back a presigned url for the attachment |
| `wasm-unsafe-eval` in the CSP | Offline text recognition compiles a WebAssembly module shipped inside the package; `eval()` and strings-as-code stay forbidden                                                                                                                                                              |

## Privacy policy url

https://crocone.github.io/kadr/privacy.html
