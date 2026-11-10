# Contributing

This repository is a fork of [Sourcebot](https://github.com/sourcebot-dev/sourcebot), hosted at [KS/solutions/ide-infra/sourcebot](https://git.kudelski.com/KS/solutions/ide-infra/sourcebot).

## License

The code is licensed under the [Functional Source License, Version 1.1, ALv2 Future License](LICENSE.md). The upstream enterprise (`ee`) code has been removed from this fork, so every contribution falls under that license. Third-party components, such as [zoekt](vendor/zoekt), keep their original licenses.

## Developing Sourcebot

1. Install <a href="https://go.dev/doc/install"><img src="https://go.dev/favicon.ico" width="16" height="16"> go</a>, <a href="https://docs.docker.com/get-started/get-docker/"><img src="https://www.docker.com/favicon.ico" width="16" height="16"> docker</a>, and <a href="https://nodejs.org/"><img src="https://nodejs.org/favicon.ico" width="16" height="16"> NodeJS</a>. NodeJS `24` or later is required.

2. Install [universal-ctags](https://github.com/universal-ctags/ctags) v6.1.0 (required by zoekt). Newer versions have a known incompatibility with zoekt.

    **macOS:** Run the provided install script:
    ```sh
    ./install-ctags-macos.sh
    ```

    **Linux and other platforms:** Build from source:
    ```sh
    curl https://codeload.github.com/universal-ctags/ctags/tar.gz/v6.1.0 | tar xz -C /tmp
    cd /tmp/ctags-6.1.0
    ./autogen.sh
    ./configure --program-prefix=universal- --enable-json
    make -j$(nproc)
    sudo make install
    ```

    After installing, set `CTAGS_COMMAND` in your `.env.development.local` to the path of the installed binary (e.g. `/usr/local/bin/universal-ctags`).

3. Install and enable Corepack so the repository uses the Yarn version pinned in `package.json`:
    ```sh
    npm install -g corepack
    corepack enable
    yarn --version
    ```

4. Clone the repository with submodules:
    ```sh
    git clone --recurse-submodules git@git.kudelski.com:KS/solutions/ide-infra/sourcebot.git
    ```

5. Run `make` to build zoekt and install dependencies:
    ```sh
    cd sourcebot
    make
    ```

    The zoekt binaries and web dependencies are placed into `bin` and `node_modules` respectively.

    **Note**: Run `make` again whenever you switch branches so all dependencies stay up to date.

6. Start the development Docker containers for PostgreSQL and Redis:
    ```sh
    docker compose -f docker-compose-dev.yml up -d
    ```

7. Generate the database schema:
    ```sh
    yarn dev:prisma:migrate:dev
    ```

8. Create a copy of `.env.development` and name it `.env.development.local`. Update the required environment variables.

9. If you're using a declarative configuration file, create it and point the `CONFIG_PATH` environment variable in your `.env.development.local` file at it.

10. Start Sourcebot:
    ```sh
    yarn dev
    ```

    A `.sourcebot` directory is created and zoekt begins indexing the repositories found in the `config.json` file.

11. Start searching at `http://localhost:3000`.

## Testing

Run the tests for all workspaces:

```sh
yarn test
```

The `test:yarn` job in [.gitlab-ci.yml](.gitlab-ci.yml) runs the same tests on every pipeline and reports coverage.

## Debugging

### React Scan

[React Scan](https://react-scan.com) highlights components that are re-rendering, which is useful for diagnosing unnecessary renders and performance issues. It only runs in development mode.

To enable it, set the following in your `.env.development.local`:

```sh
DEBUG_ENABLE_REACT_SCAN=true
```

Then restart the dev server. Components that re-render are highlighted in the browser.

## Merge Requests

- Open merge requests against `master` on [GitLab](https://git.kudelski.com/KS/solutions/ide-infra/sourcebot/-/merge_requests).
- Keep merge requests small and focused.
- Explain the problem and why your change fixes it.
- Before adding new functionality, check that it doesn't already exist elsewhere in the codebase.
- Make sure the pipeline passes before asking for a review.
- For UI changes, include before and after screenshots.
- For logic changes, explain how you verified the change and how a reviewer can reproduce it.

### Titles

Merge request titles follow conventional commit standards:

- `feat:` new feature or functionality
- `fix:` bug fix
- `docs:` documentation or README changes
- `chore:` maintenance tasks, dependency updates, etc.
- `refactor:` code refactoring without changing behavior
- `test:` adding or updating tests

You can optionally include a scope to indicate which package is affected:

- `feat(web):` feature in the web package
- `fix(worker):` bug fix in the worker package (`backend/`)
