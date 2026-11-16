# FINN Keyword Filter

**English** | [Tiếng Việt](README.vi.md)

A **Tampermonkey** / **Violentmonkey** userscript for the real estate section of [finn.no](https://www.finn.no/realestate/browse.html). Type or click keywords such as `tvangssalg`, `oppussingsobjekt` or `dødsbo` to filter the listings, then see those keywords highlighted on each ad page.

## Install

1. Install Tampermonkey or Violentmonkey in your browser.
2. Open this link and your userscript manager will show its install page:
   **https://raw.githubusercontent.com/loooveee/script/main/finn-keyword-filter/finn-keyword-filter.user.js**

Installed this way, the script updates automatically.

## Usage

### On a search page

On any FINN real estate search page (for example [Bolig til salgs](https://www.finn.no/realestate/homes/search.html)), a **🔎 Keyword filter** panel appears in the bottom-right corner. Click its title to collapse or expand it.

- **Type keywords and press Enter** to filter right away. Separate several keywords with commas, and put `-` in front of a keyword to exclude it. Keywords you type are saved as chips for next time.
- **Click a chip** to cycle through its states: must have (green), exclude (red), off. The **×** on a chip removes it from the list.
- **Match: ANY keyword / ALL keywords** switches between OR and AND for the green chips.
- **Clear** turns every chip off.

FINN's own filters (area, price, property type…) are kept when the keyword filter changes.

The built-in chips are `tvangssalg`, `oppussingsobjekt`, `oppussingsbehov`, `renoveringsobjekt`, `moderniseringsbehov`, `oppgraderingsbehov`, `trenger oppussing`, `dødsbo`, `selges som den er`, `rivningsobjekt`, `utleiedel` and `hybel`.

### On an ad page

When you open an ad while a filter is active, the must-have keywords are highlighted in yellow. A small badge in the bottom-right corner shows the number of matches; click it to jump from one match to the next.

## How it works

FINN's search box already searches the full ad text and understands `OR`, `-word` and `"exact phrase"`. The script only builds that query from your chips and puts it in the `q` parameter of the search URL, so FINN does the filtering across all results, not just the page you are on.

## Notes

- **The script sends no requests of its own.** It only changes the search URL and reads the page you already opened. Your keywords and selection are stored in the userscript manager.
- **A matching ad may show no highlight.** FINN can match a keyword that is not in the visible ad text; the badge then says the keyword was not found.
- **If you type something else into FINN's own search box**, the panel's selection is cleared, unless the query consists only of keywords from the chip list.
