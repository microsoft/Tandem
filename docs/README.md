# Using Tandem

Tandem helps you turn an idea or an existing application into a Design you can
inspect, then implement it with your explicit approval. Open your **project
folder**; choose how to begin, not which engine to manage.

| Start here | What you will find |
| --- | --- |
| [The Tandem story](the-tandem-story.md) | Why a running app is not always the app you intended, told through the existing presentation and a concrete project journey. |
| [Quick start](quick-start.md) | Launch the source candidate and take either the empty-project Preparation path or the existing-files Development path. |
| [User manual](user-manual.md) | The workspace, phase controls, Design, questions, implementation, settings and saved outputs. |
| [Use-case recipes](use-cases.md) | Short tasks: revise drawings, inspect a prototype update, refine Design, approve work, and export an outcome. |
| [Troubleshooting and lifecycle](troubleshooting.md) | Preview recovery, queued work, Stop versus Close, returning later and startup problems. |

## Which version does this guide describe?

These pages describe the **integrated source candidate**, not a promise that
the same features are on `main`, in an installed extension, or in a published
download. The workflow baseline is source commit `1a2a785`; maintenance and voice
instructions additionally reflect committed cleanup `fe16b72`. A build without
that cleanup has different maintenance/sign-in placement.
[Root package.json](../package.json) is the version authority.
The [quick start](quick-start.md#launch-the-source-candidate) builds from source;
it does not install a global extension or publish anything.

If you have an installed release, use the instructions supplied with that
release. Do not overwrite an installation just to make its UI match this guide.
Windows, PowerShell and actual Node 24+ are the currently qualified environment.
These pages do not certify every browser, external integration or accessibility
scenario.

## Presentations and contributor material

The [six-slide opening presentation](../stage2/docs/tandem-opening-slides-v2.html#1)
provides the story and illustrations. The
[narrative's slide notes](the-tandem-story.md#reading-the-slides-with-the-current-product)
explain where historical screenshots and diagrams differ from the current UI.
Open the checked-out HTML in a browser to use its slide controls; a repository
website may show HTML source instead.

Implementation and architecture material stays separate:
[root implementation notes](../README.md#standalone-nodebrowser-app),
[Stage 2 implementation guide](../stage2/tandem/README.md), and
[design reading guide](../stage2/docs/README.md).
The Stage 2-only installation guide is not the integrated application's
quick start.
