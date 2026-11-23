# UI design authoring

Generated from the production DSL and screen contracts. Users do not need to
author these files themselves; the agent uses ordinary temporary files.

Source reference IDs identify actual brief statements or supplied requirements.
Keep their meaning/attribution in chat and screen purpose/notes, not invented
answers. Screen IDs and source IDs are distinct.

## Operations

Outline uses upsert-screen for ALL screens first, then upsert-transition,
then {"op":"done"}. Screen metadata has id, title, purpose, decisionIds, width,
height and notes; do not include ui.

Content uses {"op":"ui","screenId":"home","edit":{...DSL operation...}}
and optional screen-status processing/ready, followed by {"op":"done"}.
It cannot change the outlined map. Every screen must have meaningful content.

Revision additionally supports upsert-screen, upsert-transition,
{"op":"remove-screen","screenId":"id"} and
{"op":"remove-transition","transitionId":"id"}. Patch existing IDs, never
rebuild unrelated nodes. Remove obsolete navigation actions when removing edges.

Button.action and Link.destination name exact outgoing transition IDs, not
URLs or executable handlers. Unlinked actions have no business behavior.
Components accept their own declared props, not arbitrary CSS/HTML.
Unknown icons fail validation; omit decoration rather than guess.

## DSL operations

```json
{
  "oneOf": [
    {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "op": {
          "const": "add"
        },
        "parent": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
          "maxLength": 64
        },
        "after": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
              "maxLength": 64
            },
            {
              "type": "null"
            }
          ]
        },
        "component": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
              "maxLength": 64
            },
            "type": {
              "enum": [
                "Screen",
                "Stack",
                "Row",
                "Grid",
                "Card",
                "Section",
                "Heading",
                "Text",
                "Button",
                "Input",
                "Textarea",
                "Select",
                "Checkbox",
                "Switch",
                "Badge",
                "Divider",
                "Spacer",
                "Image",
                "Avatar",
                "Icon",
                "Link",
                "Progress",
                "Stat",
                "Alert",
                "List"
              ]
            },
            "props": {
              "type": "object",
              "maxProperties": 24
            }
          },
          "required": [
            "id",
            "type",
            "props"
          ]
        }
      },
      "required": [
        "op",
        "parent",
        "component"
      ]
    },
    {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "op": {
          "const": "update"
        },
        "id": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
          "maxLength": 64
        },
        "props": {
          "type": "object",
          "maxProperties": 24
        }
      },
      "required": [
        "op",
        "id",
        "props"
      ]
    },
    {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "op": {
          "const": "remove"
        },
        "id": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
          "maxLength": 64
        }
      },
      "required": [
        "op",
        "id"
      ]
    },
    {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "op": {
          "const": "move"
        },
        "id": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
          "maxLength": 64
        },
        "parent": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
          "maxLength": 64
        },
        "after": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
              "maxLength": 64
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "op",
        "id",
        "parent"
      ]
    },
    {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "op": {
          "const": "setToken"
        },
        "key": {
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger",
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8",
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full",
            "font.size.caption",
            "font.size.body",
            "font.size.large",
            "font.size.title",
            "font.size.hero",
            "font.weight.regular",
            "font.weight.medium",
            "font.weight.semibold",
            "font.weight.bold",
            "size.narrow",
            "size.content",
            "size.wide"
          ]
        },
        "value": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "number"
            }
          ]
        }
      },
      "required": [
        "op",
        "key",
        "value"
      ]
    }
  ]
}
```

## Component catalog

```json
{
  "Screen": {
    "container": true,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "gap": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ],
          "default": "space.4"
        },
        "align": {
          "type": "string",
          "enum": [
            "start",
            "center",
            "end",
            "stretch"
          ],
          "default": "stretch"
        },
        "justify": {
          "type": "string",
          "enum": [
            "start",
            "center",
            "end",
            "between"
          ],
          "default": "start"
        },
        "maxWidth": {
          "type": "string",
          "enum": [
            "size.narrow",
            "size.content",
            "size.wide"
          ],
          "default": "size.wide"
        }
      },
      "required": []
    },
    "defaults": {
      "padding": "space.6",
      "background": "color.background"
    }
  },
  "Stack": {
    "container": true,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "gap": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ],
          "default": "space.4"
        },
        "align": {
          "type": "string",
          "enum": [
            "start",
            "center",
            "end",
            "stretch"
          ],
          "default": "stretch"
        },
        "justify": {
          "type": "string",
          "enum": [
            "start",
            "center",
            "end",
            "between"
          ],
          "default": "start"
        }
      },
      "required": []
    },
    "defaults": {}
  },
  "Row": {
    "container": true,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "gap": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ],
          "default": "space.4"
        },
        "align": {
          "type": "string",
          "enum": [
            "start",
            "center",
            "end",
            "stretch"
          ],
          "default": "stretch"
        },
        "justify": {
          "type": "string",
          "enum": [
            "start",
            "center",
            "end",
            "between"
          ],
          "default": "start"
        },
        "wrap": {
          "type": "boolean",
          "default": true
        }
      },
      "required": []
    },
    "defaults": {}
  },
  "Grid": {
    "container": true,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "gap": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ],
          "default": "space.4"
        },
        "align": {
          "type": "string",
          "enum": [
            "start",
            "center",
            "end",
            "stretch"
          ],
          "default": "stretch"
        },
        "justify": {
          "type": "string",
          "enum": [
            "start",
            "center",
            "end",
            "between"
          ],
          "default": "start"
        },
        "columns": {
          "type": "integer",
          "minimum": 1,
          "maximum": 6,
          "default": 2
        }
      },
      "required": []
    },
    "defaults": {}
  },
  "Card": {
    "container": true,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "gap": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ],
          "default": "space.4"
        },
        "align": {
          "type": "string",
          "enum": [
            "start",
            "center",
            "end",
            "stretch"
          ],
          "default": "stretch"
        },
        "justify": {
          "type": "string",
          "enum": [
            "start",
            "center",
            "end",
            "between"
          ],
          "default": "start"
        },
        "bordered": {
          "type": "boolean",
          "default": true
        }
      },
      "required": []
    },
    "defaults": {
      "padding": "space.5",
      "background": "color.surface",
      "radius": "radius.lg"
    }
  },
  "Section": {
    "container": true,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "gap": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ],
          "default": "space.4"
        },
        "align": {
          "type": "string",
          "enum": [
            "start",
            "center",
            "end",
            "stretch"
          ],
          "default": "stretch"
        },
        "justify": {
          "type": "string",
          "enum": [
            "start",
            "center",
            "end",
            "between"
          ],
          "default": "start"
        },
        "label": {
          "type": "string",
          "maxLength": 200,
          "minLength": 1
        }
      },
      "required": [
        "label"
      ]
    },
    "defaults": {}
  },
  "Heading": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "size": {
          "type": "string",
          "enum": [
            "font.size.caption",
            "font.size.body",
            "font.size.large",
            "font.size.title",
            "font.size.hero"
          ],
          "default": "font.size.body"
        },
        "weight": {
          "type": "string",
          "enum": [
            "font.weight.regular",
            "font.weight.medium",
            "font.weight.semibold",
            "font.weight.bold"
          ],
          "default": "font.weight.regular"
        },
        "textAlign": {
          "type": "string",
          "enum": [
            "left",
            "center",
            "right"
          ],
          "default": "left"
        },
        "text": {
          "type": "string",
          "maxLength": 200,
          "minLength": 1
        },
        "level": {
          "type": "integer",
          "minimum": 1,
          "maximum": 6,
          "default": 2
        }
      },
      "required": [
        "text"
      ]
    },
    "defaults": {
      "size": "font.size.title",
      "weight": "font.weight.bold"
    }
  },
  "Text": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "size": {
          "type": "string",
          "enum": [
            "font.size.caption",
            "font.size.body",
            "font.size.large",
            "font.size.title",
            "font.size.hero"
          ],
          "default": "font.size.body"
        },
        "weight": {
          "type": "string",
          "enum": [
            "font.weight.regular",
            "font.weight.medium",
            "font.weight.semibold",
            "font.weight.bold"
          ],
          "default": "font.weight.regular"
        },
        "textAlign": {
          "type": "string",
          "enum": [
            "left",
            "center",
            "right"
          ],
          "default": "left"
        },
        "text": {
          "type": "string",
          "maxLength": 2000
        },
        "tone": {
          "type": "string",
          "enum": [
            "default",
            "muted"
          ],
          "default": "default"
        }
      },
      "required": [
        "text"
      ]
    },
    "defaults": {}
  },
  "Button": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "icon": {
          "type": "string",
          "maxLength": 100,
          "pattern": "^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$",
          "description": "Canonical kebab-case name from bundled Lucide; use get_icons or searchIcons to look up names.",
          "default": ""
        },
        "iconPosition": {
          "type": "string",
          "enum": [
            "start",
            "end"
          ],
          "default": "start"
        },
        "label": {
          "type": "string",
          "maxLength": 200,
          "minLength": 1
        },
        "variant": {
          "type": "string",
          "enum": [
            "primary",
            "secondary",
            "ghost",
            "danger"
          ],
          "default": "primary"
        },
        "disabled": {
          "type": "boolean",
          "default": false
        },
        "action": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
        }
      },
      "required": [
        "label"
      ]
    },
    "defaults": {}
  },
  "Input": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "label": {
          "type": "string",
          "maxLength": 200,
          "minLength": 1
        },
        "value": {
          "type": "string",
          "maxLength": 2000,
          "default": ""
        },
        "placeholder": {
          "type": "string",
          "maxLength": 200,
          "default": ""
        },
        "disabled": {
          "type": "boolean",
          "default": false
        },
        "required": {
          "type": "boolean",
          "default": false
        },
        "helper": {
          "type": "string",
          "maxLength": 300,
          "default": ""
        },
        "type": {
          "type": "string",
          "enum": [
            "text",
            "email",
            "password",
            "number",
            "search",
            "tel",
            "url"
          ],
          "default": "text"
        }
      },
      "required": [
        "label"
      ]
    },
    "defaults": {}
  },
  "Textarea": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "label": {
          "type": "string",
          "maxLength": 200,
          "minLength": 1
        },
        "value": {
          "type": "string",
          "maxLength": 2000,
          "default": ""
        },
        "placeholder": {
          "type": "string",
          "maxLength": 200,
          "default": ""
        },
        "disabled": {
          "type": "boolean",
          "default": false
        },
        "required": {
          "type": "boolean",
          "default": false
        },
        "helper": {
          "type": "string",
          "maxLength": 300,
          "default": ""
        },
        "rows": {
          "type": "integer",
          "minimum": 2,
          "maximum": 12,
          "default": 4
        }
      },
      "required": [
        "label"
      ]
    },
    "defaults": {}
  },
  "Select": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "label": {
          "type": "string",
          "maxLength": 200,
          "minLength": 1
        },
        "options": {
          "type": "array",
          "minItems": 1,
          "maxItems": 50,
          "items": {
            "type": "string",
            "maxLength": 200,
            "minLength": 1
          }
        },
        "value": {
          "type": "string",
          "maxLength": 200,
          "default": ""
        },
        "disabled": {
          "type": "boolean",
          "default": false
        },
        "required": {
          "type": "boolean",
          "default": false
        }
      },
      "required": [
        "label",
        "options"
      ]
    },
    "defaults": {}
  },
  "Checkbox": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "label": {
          "type": "string",
          "maxLength": 200,
          "minLength": 1
        },
        "checked": {
          "type": "boolean",
          "default": false
        },
        "disabled": {
          "type": "boolean",
          "default": false
        }
      },
      "required": [
        "label"
      ]
    },
    "defaults": {}
  },
  "Switch": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "label": {
          "type": "string",
          "maxLength": 200,
          "minLength": 1
        },
        "checked": {
          "type": "boolean",
          "default": false
        },
        "disabled": {
          "type": "boolean",
          "default": false
        }
      },
      "required": [
        "label"
      ]
    },
    "defaults": {}
  },
  "Badge": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "text": {
          "type": "string",
          "maxLength": 200,
          "minLength": 1
        },
        "tone": {
          "type": "string",
          "enum": [
            "neutral",
            "primary",
            "success",
            "warning",
            "danger"
          ],
          "default": "neutral"
        }
      },
      "required": [
        "text"
      ]
    },
    "defaults": {}
  },
  "Divider": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        }
      },
      "required": []
    },
    "defaults": {}
  },
  "Spacer": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "size": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ],
          "default": "space.4"
        }
      },
      "required": []
    },
    "defaults": {}
  },
  "Image": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "alt": {
          "type": "string",
          "maxLength": 200,
          "minLength": 1
        },
        "aspect": {
          "type": "string",
          "enum": [
            "wide",
            "square",
            "portrait"
          ],
          "default": "wide"
        }
      },
      "required": [
        "alt"
      ]
    },
    "defaults": {}
  },
  "Avatar": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "name": {
          "type": "string",
          "maxLength": 200,
          "minLength": 1
        },
        "size": {
          "type": "string",
          "enum": [
            "sm",
            "md",
            "lg"
          ],
          "default": "md"
        }
      },
      "required": [
        "name"
      ]
    },
    "defaults": {}
  },
  "Icon": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "name": {
          "type": "string",
          "maxLength": 100,
          "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$",
          "description": "Canonical kebab-case name from bundled Lucide; use get_icons or searchIcons to look up names."
        },
        "size": {
          "type": "string",
          "enum": [
            "sm",
            "md",
            "lg"
          ],
          "default": "md"
        },
        "label": {
          "type": "string",
          "maxLength": 200,
          "default": ""
        }
      },
      "required": [
        "name"
      ]
    },
    "defaults": {}
  },
  "Link": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "icon": {
          "type": "string",
          "maxLength": 100,
          "pattern": "^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$",
          "description": "Canonical kebab-case name from bundled Lucide; use get_icons or searchIcons to look up names.",
          "default": ""
        },
        "iconPosition": {
          "type": "string",
          "enum": [
            "start",
            "end"
          ],
          "default": "start"
        },
        "label": {
          "type": "string",
          "maxLength": 200,
          "minLength": 1
        },
        "destination": {
          "type": "string",
          "maxLength": 200,
          "default": ""
        }
      },
      "required": [
        "label"
      ]
    },
    "defaults": {}
  },
  "Progress": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "label": {
          "type": "string",
          "maxLength": 200,
          "minLength": 1
        },
        "value": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100,
          "default": 0
        }
      },
      "required": [
        "label"
      ]
    },
    "defaults": {}
  },
  "Stat": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "label": {
          "type": "string",
          "maxLength": 200,
          "minLength": 1
        },
        "value": {
          "type": "string",
          "maxLength": 200,
          "minLength": 1
        },
        "detail": {
          "type": "string",
          "maxLength": 300,
          "default": ""
        }
      },
      "required": [
        "label",
        "value"
      ]
    },
    "defaults": {}
  },
  "Alert": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "title": {
          "type": "string",
          "maxLength": 200,
          "minLength": 1
        },
        "text": {
          "type": "string",
          "maxLength": 2000,
          "default": ""
        },
        "tone": {
          "type": "string",
          "enum": [
            "info",
            "success",
            "warning",
            "danger"
          ],
          "default": "info"
        }
      },
      "required": [
        "title"
      ]
    },
    "defaults": {}
  },
  "List": {
    "container": false,
    "props": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "padding": {
          "type": "string",
          "enum": [
            "space.0",
            "space.1",
            "space.2",
            "space.3",
            "space.4",
            "space.5",
            "space.6",
            "space.7",
            "space.8"
          ]
        },
        "background": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "color": {
          "type": "string",
          "enum": [
            "color.background",
            "color.surface",
            "color.text",
            "color.muted",
            "color.primary",
            "color.onPrimary",
            "color.border",
            "color.subtle",
            "color.success",
            "color.warning",
            "color.danger"
          ]
        },
        "radius": {
          "type": "string",
          "enum": [
            "radius.none",
            "radius.sm",
            "radius.md",
            "radius.lg",
            "radius.full"
          ]
        },
        "width": {
          "type": "string",
          "enum": [
            "auto",
            "fill",
            "content"
          ]
        },
        "items": {
          "type": "array",
          "minItems": 1,
          "maxItems": 50,
          "items": {
            "type": "string",
            "maxLength": 200,
            "minLength": 1
          }
        },
        "ordered": {
          "type": "boolean",
          "default": false
        }
      },
      "required": [
        "items"
      ]
    },
    "defaults": {}
  }
}
```

## Tokens

```json
{
  "color.background": {
    "kind": "color",
    "default": "#f6f8fa"
  },
  "color.surface": {
    "kind": "color",
    "default": "#ffffff"
  },
  "color.text": {
    "kind": "color",
    "default": "#1f2328"
  },
  "color.muted": {
    "kind": "color",
    "default": "#59636e"
  },
  "color.primary": {
    "kind": "color",
    "default": "#0969da"
  },
  "color.onPrimary": {
    "kind": "color",
    "default": "#ffffff"
  },
  "color.border": {
    "kind": "color",
    "default": "#d1d9e0"
  },
  "color.subtle": {
    "kind": "color",
    "default": "#eef2f6"
  },
  "color.success": {
    "kind": "color",
    "default": "#1a7f37"
  },
  "color.warning": {
    "kind": "color",
    "default": "#9a6700"
  },
  "color.danger": {
    "kind": "color",
    "default": "#cf222e"
  },
  "space.0": {
    "kind": "length",
    "default": 0,
    "min": 0,
    "max": 128
  },
  "space.1": {
    "kind": "length",
    "default": 4,
    "min": 0,
    "max": 128
  },
  "space.2": {
    "kind": "length",
    "default": 8,
    "min": 0,
    "max": 128
  },
  "space.3": {
    "kind": "length",
    "default": 12,
    "min": 0,
    "max": 128
  },
  "space.4": {
    "kind": "length",
    "default": 16,
    "min": 0,
    "max": 128
  },
  "space.5": {
    "kind": "length",
    "default": 24,
    "min": 0,
    "max": 128
  },
  "space.6": {
    "kind": "length",
    "default": 32,
    "min": 0,
    "max": 128
  },
  "space.7": {
    "kind": "length",
    "default": 48,
    "min": 0,
    "max": 128
  },
  "space.8": {
    "kind": "length",
    "default": 64,
    "min": 0,
    "max": 128
  },
  "radius.none": {
    "kind": "length",
    "default": 0,
    "min": 0,
    "max": 999
  },
  "radius.sm": {
    "kind": "length",
    "default": 4,
    "min": 0,
    "max": 999
  },
  "radius.md": {
    "kind": "length",
    "default": 8,
    "min": 0,
    "max": 999
  },
  "radius.lg": {
    "kind": "length",
    "default": 12,
    "min": 0,
    "max": 999
  },
  "radius.full": {
    "kind": "length",
    "default": 999,
    "min": 0,
    "max": 999
  },
  "font.size.caption": {
    "kind": "length",
    "default": 12,
    "min": 10,
    "max": 72
  },
  "font.size.body": {
    "kind": "length",
    "default": 14,
    "min": 10,
    "max": 72
  },
  "font.size.large": {
    "kind": "length",
    "default": 18,
    "min": 10,
    "max": 72
  },
  "font.size.title": {
    "kind": "length",
    "default": 24,
    "min": 10,
    "max": 72
  },
  "font.size.hero": {
    "kind": "length",
    "default": 36,
    "min": 10,
    "max": 72
  },
  "font.weight.regular": {
    "kind": "weight",
    "default": 400,
    "min": 400,
    "max": 800
  },
  "font.weight.medium": {
    "kind": "weight",
    "default": 500,
    "min": 400,
    "max": 800
  },
  "font.weight.semibold": {
    "kind": "weight",
    "default": 600,
    "min": 400,
    "max": 800
  },
  "font.weight.bold": {
    "kind": "weight",
    "default": 700,
    "min": 400,
    "max": 800
  },
  "size.narrow": {
    "kind": "length",
    "default": 560,
    "min": 240,
    "max": 1600
  },
  "size.content": {
    "kind": "length",
    "default": 960,
    "min": 240,
    "max": 1600
  },
  "size.wide": {
    "kind": "length",
    "default": 1200,
    "min": 240,
    "max": 1600
  }
}
```

## Existing multi-screen document

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "version",
    "screens",
    "transitions"
  ],
  "properties": {
    "version": {
      "type": "integer",
      "enum": [
        2
      ]
    },
    "screens": {
      "type": "array",
      "minItems": 1,
      "maxItems": 8,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "title",
          "purpose",
          "decisionIds",
          "width",
          "height",
          "ui",
          "notes"
        ],
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"
          },
          "title": {
            "type": "string",
            "maxLength": 500,
            "minLength": 1
          },
          "purpose": {
            "type": "string",
            "maxLength": 500,
            "minLength": 1
          },
          "decisionIds": {
            "type": "array",
            "minItems": 1,
            "maxItems": 200,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 120,
              "pattern": "^[A-Za-z0-9._-]+$"
            }
          },
          "width": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10000
          },
          "height": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10000
          },
          "notes": {
            "type": "string",
            "maxLength": 4000
          },
          "ui": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "version",
              "revision",
              "root",
              "tokens",
              "nodes"
            ],
            "properties": {
              "version": {
                "const": 1
              },
              "revision": {
                "type": "integer",
                "minimum": 0
              },
              "root": {
                "type": "string",
                "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                "maxLength": 64
              },
              "tokens": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "color.background",
                  "color.surface",
                  "color.text",
                  "color.muted",
                  "color.primary",
                  "color.onPrimary",
                  "color.border",
                  "color.subtle",
                  "color.success",
                  "color.warning",
                  "color.danger",
                  "space.0",
                  "space.1",
                  "space.2",
                  "space.3",
                  "space.4",
                  "space.5",
                  "space.6",
                  "space.7",
                  "space.8",
                  "radius.none",
                  "radius.sm",
                  "radius.md",
                  "radius.lg",
                  "radius.full",
                  "font.size.caption",
                  "font.size.body",
                  "font.size.large",
                  "font.size.title",
                  "font.size.hero",
                  "font.weight.regular",
                  "font.weight.medium",
                  "font.weight.semibold",
                  "font.weight.bold",
                  "size.narrow",
                  "size.content",
                  "size.wide"
                ],
                "properties": {
                  "color.background": {
                    "type": "string",
                    "pattern": "^#[0-9a-fA-F]{6}$"
                  },
                  "color.surface": {
                    "type": "string",
                    "pattern": "^#[0-9a-fA-F]{6}$"
                  },
                  "color.text": {
                    "type": "string",
                    "pattern": "^#[0-9a-fA-F]{6}$"
                  },
                  "color.muted": {
                    "type": "string",
                    "pattern": "^#[0-9a-fA-F]{6}$"
                  },
                  "color.primary": {
                    "type": "string",
                    "pattern": "^#[0-9a-fA-F]{6}$"
                  },
                  "color.onPrimary": {
                    "type": "string",
                    "pattern": "^#[0-9a-fA-F]{6}$"
                  },
                  "color.border": {
                    "type": "string",
                    "pattern": "^#[0-9a-fA-F]{6}$"
                  },
                  "color.subtle": {
                    "type": "string",
                    "pattern": "^#[0-9a-fA-F]{6}$"
                  },
                  "color.success": {
                    "type": "string",
                    "pattern": "^#[0-9a-fA-F]{6}$"
                  },
                  "color.warning": {
                    "type": "string",
                    "pattern": "^#[0-9a-fA-F]{6}$"
                  },
                  "color.danger": {
                    "type": "string",
                    "pattern": "^#[0-9a-fA-F]{6}$"
                  },
                  "space.0": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 128
                  },
                  "space.1": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 128
                  },
                  "space.2": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 128
                  },
                  "space.3": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 128
                  },
                  "space.4": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 128
                  },
                  "space.5": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 128
                  },
                  "space.6": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 128
                  },
                  "space.7": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 128
                  },
                  "space.8": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 128
                  },
                  "radius.none": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 999
                  },
                  "radius.sm": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 999
                  },
                  "radius.md": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 999
                  },
                  "radius.lg": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 999
                  },
                  "radius.full": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 999
                  },
                  "font.size.caption": {
                    "type": "integer",
                    "minimum": 10,
                    "maximum": 72
                  },
                  "font.size.body": {
                    "type": "integer",
                    "minimum": 10,
                    "maximum": 72
                  },
                  "font.size.large": {
                    "type": "integer",
                    "minimum": 10,
                    "maximum": 72
                  },
                  "font.size.title": {
                    "type": "integer",
                    "minimum": 10,
                    "maximum": 72
                  },
                  "font.size.hero": {
                    "type": "integer",
                    "minimum": 10,
                    "maximum": 72
                  },
                  "font.weight.regular": {
                    "type": "integer",
                    "minimum": 400,
                    "maximum": 800,
                    "multipleOf": 100
                  },
                  "font.weight.medium": {
                    "type": "integer",
                    "minimum": 400,
                    "maximum": 800,
                    "multipleOf": 100
                  },
                  "font.weight.semibold": {
                    "type": "integer",
                    "minimum": 400,
                    "maximum": 800,
                    "multipleOf": 100
                  },
                  "font.weight.bold": {
                    "type": "integer",
                    "minimum": 400,
                    "maximum": 800,
                    "multipleOf": 100
                  },
                  "size.narrow": {
                    "type": "integer",
                    "minimum": 240,
                    "maximum": 1600
                  },
                  "size.content": {
                    "type": "integer",
                    "minimum": 240,
                    "maximum": 1600
                  },
                  "size.wide": {
                    "type": "integer",
                    "minimum": 240,
                    "maximum": 1600
                  }
                }
              },
              "nodes": {
                "type": "object",
                "minProperties": 1,
                "maxProperties": 2000,
                "propertyNames": {
                  "type": "string",
                  "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                  "maxLength": 64
                },
                "additionalProperties": {
                  "oneOf": [
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Screen"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 2000,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "gap": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ],
                              "default": "space.4"
                            },
                            "align": {
                              "type": "string",
                              "enum": [
                                "start",
                                "center",
                                "end",
                                "stretch"
                              ],
                              "default": "stretch"
                            },
                            "justify": {
                              "type": "string",
                              "enum": [
                                "start",
                                "center",
                                "end",
                                "between"
                              ],
                              "default": "start"
                            },
                            "maxWidth": {
                              "type": "string",
                              "enum": [
                                "size.narrow",
                                "size.content",
                                "size.wide"
                              ],
                              "default": "size.wide"
                            }
                          },
                          "required": []
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Stack"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 2000,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "gap": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ],
                              "default": "space.4"
                            },
                            "align": {
                              "type": "string",
                              "enum": [
                                "start",
                                "center",
                                "end",
                                "stretch"
                              ],
                              "default": "stretch"
                            },
                            "justify": {
                              "type": "string",
                              "enum": [
                                "start",
                                "center",
                                "end",
                                "between"
                              ],
                              "default": "start"
                            }
                          },
                          "required": []
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Row"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 2000,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "gap": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ],
                              "default": "space.4"
                            },
                            "align": {
                              "type": "string",
                              "enum": [
                                "start",
                                "center",
                                "end",
                                "stretch"
                              ],
                              "default": "stretch"
                            },
                            "justify": {
                              "type": "string",
                              "enum": [
                                "start",
                                "center",
                                "end",
                                "between"
                              ],
                              "default": "start"
                            },
                            "wrap": {
                              "type": "boolean",
                              "default": true
                            }
                          },
                          "required": []
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Grid"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 2000,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "gap": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ],
                              "default": "space.4"
                            },
                            "align": {
                              "type": "string",
                              "enum": [
                                "start",
                                "center",
                                "end",
                                "stretch"
                              ],
                              "default": "stretch"
                            },
                            "justify": {
                              "type": "string",
                              "enum": [
                                "start",
                                "center",
                                "end",
                                "between"
                              ],
                              "default": "start"
                            },
                            "columns": {
                              "type": "integer",
                              "minimum": 1,
                              "maximum": 6,
                              "default": 2
                            }
                          },
                          "required": []
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Card"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 2000,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "gap": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ],
                              "default": "space.4"
                            },
                            "align": {
                              "type": "string",
                              "enum": [
                                "start",
                                "center",
                                "end",
                                "stretch"
                              ],
                              "default": "stretch"
                            },
                            "justify": {
                              "type": "string",
                              "enum": [
                                "start",
                                "center",
                                "end",
                                "between"
                              ],
                              "default": "start"
                            },
                            "bordered": {
                              "type": "boolean",
                              "default": true
                            }
                          },
                          "required": []
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Section"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 2000,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "gap": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ],
                              "default": "space.4"
                            },
                            "align": {
                              "type": "string",
                              "enum": [
                                "start",
                                "center",
                                "end",
                                "stretch"
                              ],
                              "default": "stretch"
                            },
                            "justify": {
                              "type": "string",
                              "enum": [
                                "start",
                                "center",
                                "end",
                                "between"
                              ],
                              "default": "start"
                            },
                            "label": {
                              "type": "string",
                              "maxLength": 200,
                              "minLength": 1
                            }
                          },
                          "required": [
                            "label"
                          ]
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Heading"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "size": {
                              "type": "string",
                              "enum": [
                                "font.size.caption",
                                "font.size.body",
                                "font.size.large",
                                "font.size.title",
                                "font.size.hero"
                              ],
                              "default": "font.size.body"
                            },
                            "weight": {
                              "type": "string",
                              "enum": [
                                "font.weight.regular",
                                "font.weight.medium",
                                "font.weight.semibold",
                                "font.weight.bold"
                              ],
                              "default": "font.weight.regular"
                            },
                            "textAlign": {
                              "type": "string",
                              "enum": [
                                "left",
                                "center",
                                "right"
                              ],
                              "default": "left"
                            },
                            "text": {
                              "type": "string",
                              "maxLength": 200,
                              "minLength": 1
                            },
                            "level": {
                              "type": "integer",
                              "minimum": 1,
                              "maximum": 6,
                              "default": 2
                            }
                          },
                          "required": [
                            "text"
                          ]
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Text"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "size": {
                              "type": "string",
                              "enum": [
                                "font.size.caption",
                                "font.size.body",
                                "font.size.large",
                                "font.size.title",
                                "font.size.hero"
                              ],
                              "default": "font.size.body"
                            },
                            "weight": {
                              "type": "string",
                              "enum": [
                                "font.weight.regular",
                                "font.weight.medium",
                                "font.weight.semibold",
                                "font.weight.bold"
                              ],
                              "default": "font.weight.regular"
                            },
                            "textAlign": {
                              "type": "string",
                              "enum": [
                                "left",
                                "center",
                                "right"
                              ],
                              "default": "left"
                            },
                            "text": {
                              "type": "string",
                              "maxLength": 2000
                            },
                            "tone": {
                              "type": "string",
                              "enum": [
                                "default",
                                "muted"
                              ],
                              "default": "default"
                            }
                          },
                          "required": [
                            "text"
                          ]
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Button"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "icon": {
                              "type": "string",
                              "maxLength": 100,
                              "pattern": "^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$",
                              "description": "Canonical kebab-case name from bundled Lucide; use get_icons or searchIcons to look up names.",
                              "default": ""
                            },
                            "iconPosition": {
                              "type": "string",
                              "enum": [
                                "start",
                                "end"
                              ],
                              "default": "start"
                            },
                            "label": {
                              "type": "string",
                              "maxLength": 200,
                              "minLength": 1
                            },
                            "variant": {
                              "type": "string",
                              "enum": [
                                "primary",
                                "secondary",
                                "ghost",
                                "danger"
                              ],
                              "default": "primary"
                            },
                            "disabled": {
                              "type": "boolean",
                              "default": false
                            },
                            "action": {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
                            }
                          },
                          "required": [
                            "label"
                          ]
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Input"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "label": {
                              "type": "string",
                              "maxLength": 200,
                              "minLength": 1
                            },
                            "value": {
                              "type": "string",
                              "maxLength": 2000,
                              "default": ""
                            },
                            "placeholder": {
                              "type": "string",
                              "maxLength": 200,
                              "default": ""
                            },
                            "disabled": {
                              "type": "boolean",
                              "default": false
                            },
                            "required": {
                              "type": "boolean",
                              "default": false
                            },
                            "helper": {
                              "type": "string",
                              "maxLength": 300,
                              "default": ""
                            },
                            "type": {
                              "type": "string",
                              "enum": [
                                "text",
                                "email",
                                "password",
                                "number",
                                "search",
                                "tel",
                                "url"
                              ],
                              "default": "text"
                            }
                          },
                          "required": [
                            "label"
                          ]
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Textarea"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "label": {
                              "type": "string",
                              "maxLength": 200,
                              "minLength": 1
                            },
                            "value": {
                              "type": "string",
                              "maxLength": 2000,
                              "default": ""
                            },
                            "placeholder": {
                              "type": "string",
                              "maxLength": 200,
                              "default": ""
                            },
                            "disabled": {
                              "type": "boolean",
                              "default": false
                            },
                            "required": {
                              "type": "boolean",
                              "default": false
                            },
                            "helper": {
                              "type": "string",
                              "maxLength": 300,
                              "default": ""
                            },
                            "rows": {
                              "type": "integer",
                              "minimum": 2,
                              "maximum": 12,
                              "default": 4
                            }
                          },
                          "required": [
                            "label"
                          ]
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Select"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "label": {
                              "type": "string",
                              "maxLength": 200,
                              "minLength": 1
                            },
                            "options": {
                              "type": "array",
                              "minItems": 1,
                              "maxItems": 50,
                              "items": {
                                "type": "string",
                                "maxLength": 200,
                                "minLength": 1
                              }
                            },
                            "value": {
                              "type": "string",
                              "maxLength": 200,
                              "default": ""
                            },
                            "disabled": {
                              "type": "boolean",
                              "default": false
                            },
                            "required": {
                              "type": "boolean",
                              "default": false
                            }
                          },
                          "required": [
                            "label",
                            "options"
                          ]
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Checkbox"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "label": {
                              "type": "string",
                              "maxLength": 200,
                              "minLength": 1
                            },
                            "checked": {
                              "type": "boolean",
                              "default": false
                            },
                            "disabled": {
                              "type": "boolean",
                              "default": false
                            }
                          },
                          "required": [
                            "label"
                          ]
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Switch"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "label": {
                              "type": "string",
                              "maxLength": 200,
                              "minLength": 1
                            },
                            "checked": {
                              "type": "boolean",
                              "default": false
                            },
                            "disabled": {
                              "type": "boolean",
                              "default": false
                            }
                          },
                          "required": [
                            "label"
                          ]
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Badge"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "text": {
                              "type": "string",
                              "maxLength": 200,
                              "minLength": 1
                            },
                            "tone": {
                              "type": "string",
                              "enum": [
                                "neutral",
                                "primary",
                                "success",
                                "warning",
                                "danger"
                              ],
                              "default": "neutral"
                            }
                          },
                          "required": [
                            "text"
                          ]
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Divider"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            }
                          },
                          "required": []
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Spacer"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "size": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ],
                              "default": "space.4"
                            }
                          },
                          "required": []
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Image"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "alt": {
                              "type": "string",
                              "maxLength": 200,
                              "minLength": 1
                            },
                            "aspect": {
                              "type": "string",
                              "enum": [
                                "wide",
                                "square",
                                "portrait"
                              ],
                              "default": "wide"
                            }
                          },
                          "required": [
                            "alt"
                          ]
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Avatar"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "name": {
                              "type": "string",
                              "maxLength": 200,
                              "minLength": 1
                            },
                            "size": {
                              "type": "string",
                              "enum": [
                                "sm",
                                "md",
                                "lg"
                              ],
                              "default": "md"
                            }
                          },
                          "required": [
                            "name"
                          ]
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Icon"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "name": {
                              "type": "string",
                              "maxLength": 100,
                              "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$",
                              "description": "Canonical kebab-case name from bundled Lucide; use get_icons or searchIcons to look up names."
                            },
                            "size": {
                              "type": "string",
                              "enum": [
                                "sm",
                                "md",
                                "lg"
                              ],
                              "default": "md"
                            },
                            "label": {
                              "type": "string",
                              "maxLength": 200,
                              "default": ""
                            }
                          },
                          "required": [
                            "name"
                          ]
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Link"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "icon": {
                              "type": "string",
                              "maxLength": 100,
                              "pattern": "^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$",
                              "description": "Canonical kebab-case name from bundled Lucide; use get_icons or searchIcons to look up names.",
                              "default": ""
                            },
                            "iconPosition": {
                              "type": "string",
                              "enum": [
                                "start",
                                "end"
                              ],
                              "default": "start"
                            },
                            "label": {
                              "type": "string",
                              "maxLength": 200,
                              "minLength": 1
                            },
                            "destination": {
                              "type": "string",
                              "maxLength": 200,
                              "default": ""
                            }
                          },
                          "required": [
                            "label"
                          ]
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Progress"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "label": {
                              "type": "string",
                              "maxLength": 200,
                              "minLength": 1
                            },
                            "value": {
                              "type": "integer",
                              "minimum": 0,
                              "maximum": 100,
                              "default": 0
                            }
                          },
                          "required": [
                            "label"
                          ]
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Stat"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "label": {
                              "type": "string",
                              "maxLength": 200,
                              "minLength": 1
                            },
                            "value": {
                              "type": "string",
                              "maxLength": 200,
                              "minLength": 1
                            },
                            "detail": {
                              "type": "string",
                              "maxLength": 300,
                              "default": ""
                            }
                          },
                          "required": [
                            "label",
                            "value"
                          ]
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "Alert"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "title": {
                              "type": "string",
                              "maxLength": 200,
                              "minLength": 1
                            },
                            "text": {
                              "type": "string",
                              "maxLength": 2000,
                              "default": ""
                            },
                            "tone": {
                              "type": "string",
                              "enum": [
                                "info",
                                "success",
                                "warning",
                                "danger"
                              ],
                              "default": "info"
                            }
                          },
                          "required": [
                            "title"
                          ]
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "id",
                        "type",
                        "parent",
                        "children",
                        "props"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                          "maxLength": 64
                        },
                        "type": {
                          "const": "List"
                        },
                        "parent": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                              "maxLength": 64
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "maxItems": 0,
                          "items": {
                            "type": "string",
                            "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
                            "maxLength": 64
                          }
                        },
                        "props": {
                          "type": "object",
                          "additionalProperties": false,
                          "properties": {
                            "padding": {
                              "type": "string",
                              "enum": [
                                "space.0",
                                "space.1",
                                "space.2",
                                "space.3",
                                "space.4",
                                "space.5",
                                "space.6",
                                "space.7",
                                "space.8"
                              ]
                            },
                            "background": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "color": {
                              "type": "string",
                              "enum": [
                                "color.background",
                                "color.surface",
                                "color.text",
                                "color.muted",
                                "color.primary",
                                "color.onPrimary",
                                "color.border",
                                "color.subtle",
                                "color.success",
                                "color.warning",
                                "color.danger"
                              ]
                            },
                            "radius": {
                              "type": "string",
                              "enum": [
                                "radius.none",
                                "radius.sm",
                                "radius.md",
                                "radius.lg",
                                "radius.full"
                              ]
                            },
                            "width": {
                              "type": "string",
                              "enum": [
                                "auto",
                                "fill",
                                "content"
                              ]
                            },
                            "items": {
                              "type": "array",
                              "minItems": 1,
                              "maxItems": 50,
                              "items": {
                                "type": "string",
                                "maxLength": 200,
                                "minLength": 1
                              }
                            },
                            "ordered": {
                              "type": "boolean",
                              "default": false
                            }
                          },
                          "required": [
                            "items"
                          ]
                        }
                      }
                    }
                  ]
                }
              }
            }
          }
        }
      }
    },
    "transitions": {
      "type": "array",
      "maxItems": 40,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "fromScreenId",
          "toScreenId",
          "trigger",
          "description"
        ],
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"
          },
          "fromScreenId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"
          },
          "toScreenId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"
          },
          "trigger": {
            "type": "string",
            "maxLength": 500,
            "minLength": 1
          },
          "description": {
            "type": "string",
            "maxLength": 500
          }
        }
      }
    },
    "fidelity": {
      "type": "string",
      "enum": [
        "wireframe",
        "styled"
      ]
    }
  }
}
```
