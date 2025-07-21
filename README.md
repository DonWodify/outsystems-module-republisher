# OutSystems Module Republisher

Automates the republishing of OutSystems modules via Service Center using Puppeteer.

## Setup

1. Clone the repository.
2. Run `npm install` to install dependencies.
3. Create a `.env` file in the `src` directory with the following variables:
   ```
   WODIFY_USERNAME=your_username
   WODIFY_PASSWORD=your_password
   WODIFY_ENV=your_env
   ```
4. Place your `sorted-modules.json` file in the root directory.

## Usage

```
npm start [layers]
```

Or directly:

```
node src/outsystems-module-republisher.js [layers]
```

- `layers`: Optional comma-separated list of module layers to process (e.g., `OS,UI`). If omitted, all layers are processed.

## Examples

- Process all layers:
  ```
  node src/outsystems-module-republisher.js
  ```
- Process only OS modules:
  ```
  node src/outsystems-module-republisher.js OS
  ```
- Process OS and UI modules:
  ```
  node src/outsystems-module-republisher.js OS,UI
  ```

## Notes

- Requires Chrome/Chromium (handled by Puppeteer).
- Ensure `.env` is present and correct.
