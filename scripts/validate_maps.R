# Check scientific routing and metadata before publishing the rendered resource.
source("scripts/map_helpers.R")
d <- load_map_data()
stopifnot(nrow(d$points) == 704L, nrow(d$countries) == 429L,
          sum(d$points$is_new) == 108L, sum(d$countries$is_new) == 5L)
p <- subset(d$points, is_new)
countries <- subset(d$countries, is_new)
stopifnot(length(unique(p$coordinate_key)) == 85L,
          sum(p$Coord.type == "exact") == 48L, sum(p$Coord.type == "approximate") == 60L,
          sum(nzchar(p$Haplogroup)) == 98L, sum(p$GROUP == "VD_nuclear_evidence") == 10L,
          all(p$nuclear[p$GROUP == "VD_nuclear_evidence"]))
dongshi <- subset(p, input_id == "P1")
antu <- subset(p, input_id == "P49")
fuzhou <- subset(p, input_id %in% c("P86", "P87"))
sg2 <- subset(p, input_id == "P48")
stopifnot(dongshi$coord.X == 24.1832222, dongshi$coord.Y == 120.8393056,
          dongshi$reported_mt == "type T", dongshi$Host == "A. cerana",
          antu$coord.X == 43.102, antu$coord.Y == 128.908,
          antu$reported_mt == "J2-1", antu$Coord.type == "approximate",
          all(fuzhou$Host == "A. cerana"), all(fuzhou$nuclear),
          fuzhou$Year[fuzhou$input_id == "P87"] == "NA",
          grepl("AcFZ8", fuzhou$Description[fuzhou$input_id == "P87"]),
          sg2$Haplogroup == "", sg2$GROUP == "VD_nuclear_evidence")
stopifnot(nrow(d$archives) == 14L, length(unique(d$links$archive_input)) == 14L,
          nrow(d$links) == 19L, sum(nzchar(d$points$archive_note)) == 19L,
          all(countries$border_name %in% d$world$NAME), sum(countries$nuclear) == 3L)
views <- list(
  additions = build_map(d, c("A. cerana", "A. mellifera"), "V. destructor", TRUE),
  mellifera = build_map(d, "A. mellifera", c("V. destructor", "V. jacobsoni", "Varroa sp.")),
  destructor = build_map(d, "A. cerana", "V. destructor"),
  jacobsoni = build_map(d, "A. cerana", "V. jacobsoni"))
check_view <- function(map) {
  calls <- Filter(function(call) call$method == "addCircleMarkers", map$x$calls)
  circles <- do.call(rbind, lapply(calls, function(call) data.frame(
    lat = call$args[[1]], lng = call$args[[2]], group = call$args[[5]], color = call$args[[6]]$color)))
  # Every marker comes from a point-table coordinate; no country centroids are created.
  stopifnot(all(paste(circles$lat, circles$lng) %in% paste(d$points$coord.X, d$points$coord.Y)))
  circles
}
circles <- lapply(views, check_view)
sg2_markers <- subset(circles$destructor, lat == sg2$coord.X & lng == sg2$coord.Y)
stopifnot(nrow(sg2_markers) == 1L, sg2_markers$color == "#5b626b",
          sg2_markers$group == "Genome-wide evidence (WGS / RAD-seq)")
for (i in c("P1", "P49", "P86", "P87")) {
  r <- subset(p, input_id == i)
  markers <- subset(circles$additions, lat == r$coord.X & lng == r$coord.Y)
  stopifnot(paste0("Points: ", group_label(r$GROUP)) %in% markers$group)
}
fuzhou_popup <- shared_popup(subset(d$points, coordinate_key == fuzhou$coordinate_key[1]))
stopifnot(grepl("AcFZ8", fuzhou_popup), grepl("AcFZ7", fuzhou_popup), grepl("Lin et al.", fuzhou_popup))
for (i in seq_len(nrow(countries))) {
  r <- countries[i, ]
  html <- shared_popup(subset(d$countries, border_name == r$border_name), TRUE)
  stopifnot(grepl(r$Region, html, fixed = TRUE), grepl("country polygon", html, fixed = TRUE))
}
payload <- build_explorer(d)$jsHooks$render[[1]]$data
stopifnot(length(payload$records) == 1133L,
          sum(vapply(payload$records, function(r) r$evidence_level == "point", logical(1))) == 704L)
summary <- list(point_records = 704, country_records = 429, new_points = 108,
  new_countries = 5, coordinate_pairs = 85, exact = 48, approximate = 60,
  resolved_mt = 98, nuclear_only = 10, archive_groups = 14, archive_links = 19,
  country_only_additions_have_polygons = TRUE, no_country_centroid_markers = TRUE,
  SG2_neutral_only = TRUE, required_labels_and_popups = TRUE,
  explorer_payload_records = length(payload$records), retained_host_maps = names(views)[-1])
jsonlite::write_json(summary, "validation/2026-11-05/map_validation.json", pretty = TRUE, auto_unbox = TRUE)
writeLines(capture.output(sessionInfo()), "validation/2026-11-05/R_session_info.txt")
cat("PASS: map inputs, coordinates, lineage labels, shared popups, polygons and nuclear routing.\n")
