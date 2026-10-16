# Contributing to this project

## Building and compiling

You need [Node.js](https://nodejs.org/) (20.19 or newer) and, to actually mount anything,
[SSHFS-Win](https://github.com/billziss-gh/sshfs-win) (which also provides the `ssh.exe` used for host key checks).

```bash
npm install

npm run dev         # run from source with hot reload
npm run dev:tray    # same, but starting in the system tray
npm run build:dir   # build an unpacked app in release/
npm run build       # build the installer in release/
```

Try things out without touching your own connections by pointing the app at another data folder:

```powershell
$env:SSHFS_WIN_MANAGER_DATA = "$env:TEMP\sshfs-win-manager-dev"; npm run dev
```

## Checks

```bash
npm run lint
npm test
```

## How it is put together

- `src/main`: the main process. It owns the state (`store.js`, saved as `vuex.json` in the app data folder),
  runs `sshfs.exe` (`sshfs/`), keeps the trusted host keys (`sshfs/hostKeys.js`) and opens the windows.
- `src/preload`: the small API the windows are given to talk to the main process.
- `src/renderer`: the windows themselves (Vue 3). They only show the state and ask the main process to change it.
- `src/shared`: the state definition both sides use.
