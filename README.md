<h1 align="center">Sourcebot</h1>

<h3 align="center">Self-hosted code search across all your repositories</h3>

This is a fork of [Sourcebot](https://github.com/sourcebot-dev/sourcebot). Index all your repos in one place so you can search and browse them.

## Features

- **Code search** across all indexed repos and branches, with regular expressions, boolean queries, and filters by repo, file, language, or symbol.
- **File browsing** with syntax highlighting, history, blame, and diffs.
- **Connections** to GitHub, GitLab, Bitbucket, Gitea, Gerrit, Azure DevOps, and generic Git hosts.
- **Authentication** with email and password, email codes, or anonymous access, plus API keys for the [REST API](docs/api-reference/sourcebot-public.openapi.json).

## Get started

Build the image from this repository:

```sh
git submodule update --init
docker build -t sourcebot .
```

Then run it with [Docker Compose](docker-compose.yml) (change the `image` to your build) or the Helm values in [.helm/](.helm/). See the [configuration docs](https://docs.sourcebot.dev/docs/configuration/config-file) to set up your connections.

For local development, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

This project is distributed under the [Functional Source License, Version 1.1, ALv2 Future License](LICENSE.md). Third-party components, such as [zoekt](vendor/zoekt), keep their original licenses.
