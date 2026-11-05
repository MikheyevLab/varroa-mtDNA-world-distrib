# Export the same source evidence used by the map; ignore generated review annotations.
source("scripts/map_helpers.R")
d <- load_map_data(apply_reviews = FALSE)
records <- c(lapply(seq_len(nrow(d$points)), function(i) c(as.list(d$points[i, ]), evidence_level = "point")),
             lapply(seq_len(nrow(d$countries)), function(i) c(as.list(d$countries[i, ]), evidence_level = "country")))
dir.create("Data/curation", recursive = TRUE, showWarnings = FALSE)
jsonlite::write_json(records, "Data/curation/map_records.json", auto_unbox = TRUE, pretty = TRUE)
