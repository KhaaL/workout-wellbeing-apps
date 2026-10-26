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
          "food_id": "example-cottage-cheese",
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
`food_id` names the catalog food; `time` is left out for an item without one.

## Day import

**Import day file…** on Today reads the day export shape, whether Foodlog or
another tool wrote it. **Day file format & sample** shows the fields and a
sample day; the sample is made by the export code, so it always imports.

| Field | Use |
|---|---|
| `date` | Required, `YYYY-MM-DD`. The items land on this day. |
| `notes`, `activity` | Optional. Kept up to 2,000 and 500 characters; activity may be a list of lines. |
| `meals[].meal` | Required name, at most 40 characters. A name matching the meal list (ignoring case) uses the list's spelling. The day keeps the file's meal order. |
| `meals[].time`, `items[].time` | Optional `HH:MM`. Without one, an item has no time and keeps the file's order. |
| `items[].item` | Required name, at most 120 characters. |
| `items[].food_id` | Optional catalog id. |
| `items[].amount_g`, `amount_ml`, `amount` | Required: grams, millilitres, or a count such as `"1 portion"`. Grams and millilitres count as equal. |
| `items[].nutrition` | Values eaten for this amount, with the nutrition keys above. `null` or missing means unknown. |
| `items[].portion`, `items[].assumption` | Optional portion label and entry note. |
| `items[].source` | Optional. For a new food, "menu" or "restaurant" marks menu values; "typical" or "estimate" marks estimates. |
| `day_total_eaten` | Optional. The preview compares its energy and protein with the items. |
| `targets`, `subtotal`, `day_summary`, `timing` | Not imported. |

Each item links to a catalog food, in this order:

1. `food_id`, when that food exists and its unit fits (grams and millilitres
   are interchangeable; portions are not).
2. Exact name: the food's name, or brand and name, ignoring case and accents.
3. Values: energy, protein and at least two more nutrients match the food's
   values for that amount within 2% (0.05 g or 1 kcal for small values). When
   several foods match, the one sharing most words with the item name wins;
   a tie links none.
4. Otherwise a new food is added from the item's values, per 100 g, per 100 ml
   or per portion, with its source taken from the item's `source` text. A
   repeated item in the same file reuses that new food.

A linked item keeps the catalog's values when the file agrees, and the file
fills values the catalog lacks (such as a missing fibre value). When the file
disagrees, the day keeps the file's values, and the preview says so. The
preview lists every item, skipped items with their reason, and ignored fields.
A day that already has items offers **Add to the day** or **Replace the day**;
the toast's Undo reverses the import while nothing else has changed.

## Storage

Foodlog saves through the shared storage engine under `foodlog.v1` (data key
`foodlog.state.v1`). Backups and cloud copies hold foods, frozen versions,
entries, day notes and settings. Limits: 5,000 foods, 20,000 logged items,
20,000 frozen versions and 20,000 days with notes. A day file holds at most 20
meals and 300 items. Data version 2 allows entries without a time and a meal
order per day; version 1 data loads unchanged.
