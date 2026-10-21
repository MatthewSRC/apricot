# Local models

Models placed here show up in the playground's Showroom. Everything in this
folder except this file is ignored by git.

- `name.glb`: the model, optimised with `npx apricot-models path/to/model.glb --out assets/local`.
- `name.kit.json` (optional): part names and materials.

```json
{
  "title": "My car",
  "credit": "Model by … (CC-BY 4.0)",
  "paint": "paint",
  "parts": {
    "paint": "material:car_paint*",
    "glass": "material:glass",
    "wheels": "wheel_*",
    "hood": { "select": "Body_Hood", "hinge": "back", "axis": "x", "range": [0, -35] }
  },
  "materials": {
    "paint": { "preset": "car-paint", "color": "#1c4f9c" },
    "glass": "tinted-glass"
  }
}
```

`paint` is the part the colour buttons change. Parts with a hinge open when
tapped. Restart Metro after adding the first model.
