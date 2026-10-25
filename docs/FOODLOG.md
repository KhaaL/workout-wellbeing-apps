# Foodlog catalog and exports

Foodlog reads and writes a catalog JSON file, schema 1.x. A complete synthetic
example is in [examples/foodlog-catalog.json](../examples/foodlog-catalog.json).

## Catalog file

```json
{
  "schema_version": "1.0",
  "revision": 3,
  "updated": "2026-01-15",
  "notes": "Free text",
  "personal_budgets_per_day": {
    "contribution": { "protein_g": 100, "fibre_g": 30 },
    "limit": { "saturated_fat_g": 25, "salt_g": 6, "sugar_g": 50 }
  },
  "products": [ … ]
}
```

| Field | Use |
|---|---|
| `schema_version` | Must start with `1`. Other versions are refused. |
| `revision` | Optional number. Importing a lower revision than the last import asks first. |
| `personal_budgets_per_day` | Optional. `contribution` keys become "at least" targets, `limit` keys "at most" targets. Import asks before applying them. Sugar keys are skipped: labels give total sugars, so a free-sugar limit cannot be checked. |
| Other top-level fields | Kept and written back on export. |

### Products

| Field | Use |
|---|---|
| `id` | Required. Letters, digits, `.`, `-`, `_`; at most 80 characters. Merging matches on it. |
| `name` | Required, at most 120 characters. |
| `brand` | Optional, at most 80 characters. |
| `nutrition_per_100g`, `nutrition_per_100ml` or `nutrition_per_portion` | Required, exactly one decides the basis. Keys: `energy_kcal`, `energy_kj`, `protein_g`, `carbohydrate_g`, `sugars_g`, `fibre_g`, `fat_g`, `saturated_fat_g`, `salt_g`. Each is a number from 0 to 10,000, or `null` for unknown. A missing `energy_kcal` is computed from `energy_kj`. |
| `micronutrients_per_100g` / `_100ml` / `_portion` | Optional, matching the basis. Up to 20 keys ending in `_g`, `_mg` or `_ug`. |
| `serving.unit_weight_g`, `serving.powder_g`, `serving.unit_volume_ml` | A number adds a portion ("1 piece" or "1 serving"). `null` adds none; weigh one piece in the app to add it. |
| `foodlog` | Written by Foodlog's export: `kind` (`product`, `generic`, `dish`), `source` (`label`, `typical`, `menu`), `estimate`, `portions` (`[{label, amount}]` in the basis unit, at most 12), `note`, `archived`. |
| Everything else | Kept as the food's details (at most 16,384 characters), shown under **All catalog file fields**, and written back on export. Foodlog never recomputes these fields. |

A product that fails these rules is skipped and named in the import summary;
the rest of the file still imports.

### Merge rules

- A new `id` adds a food.
- For an existing `id`, the file supplies name, brand, basis, nutrients,
  micronutrients, source, estimate flag, note and details. Portions added in
  Foodlog stay, and portions from the file are added beside them. If the basis
  changes (for example from 100 g to 100 ml), local portions are dropped,
  because their amounts are in the old unit.
- Archived foods stay archived.
- A food that came from an earlier file but is missing now stays in Foodlog,
  marked "not in file".
- Foods added in Foodlog are never changed by an import.

Logged days never change on import. Each entry points to a frozen copy of the
values it was logged with.

### Export

**Export catalog JSON** writes the same schema: the last imported header
fields, every food (including foods added in Foodlog) with its unused fields
restored, and a `foodlog` block per product. `personal_budgets_per_day` takes
Foodlog's current targets for the nutrients it tracks and keeps any other keys
from the file, such as a sugar limit.

## Day export

**Export day as JSON** writes `food_log_YYYY-MM-DD.json`:

```json
{
  "date": "2026-01-20",
  "notes": "",
  "activity": ["Walk"],
  "targets": { "protein_g": 100, "fibre_g": 30, "saturated_fat_g_max": 25, "salt_g_max": 6 },
  "meals": [
    {
      "meal": "Breakfast",
      "items": [
        {
          "item": "Example Dairy Cottage Cheese 1.5%",
          "time": "08:00",
          "amount_g": 30,
          "source": "Foodlog catalog (file revision 3), label values",
          "nutrition": { "energy_kcal": 22.8, "protein_g": 4.2, "fibre_g": null, … },
          "assumption": "Entry note, when given"
        }
      ],
      "subtotal": { "energy_kcal": 22.8, …, "unknown_items": { "fibre_g": 1 } }
    }
  ],
  "day_total_eaten": { … },
  "estimated_energy_share": 0.12,
  "exported_by": "Foodlog"
}
```

Amounts use `amount_g` or `amount_ml`, or `amount` ("1.5 portions") for
per-portion foods. Items with estimated values carry `"estimate": true`.
Unknown values are `null`, and `unknown_items` counts them per nutrient.

## Storage

Foodlog saves through the shared storage engine under `foodlog.v1` (data key
`foodlog.state.v1`). Backups and cloud copies hold foods, frozen versions,
entries, day notes and settings. Limits: 5,000 foods, 20,000 logged items,
20,000 frozen versions and 20,000 days with notes.
