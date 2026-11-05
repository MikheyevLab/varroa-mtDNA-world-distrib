## ---- map-functions
# Inputs stay unchanged; these helpers prepare labels, evidence layers and popups.
read_evidence <- function(path) {
  read.csv(path, fileEncoding = "UTF-8-BOM", colClasses = "character",
           na.strings = character(), check.names = FALSE, stringsAsFactors = FALSE)
}
row_key <- function(x, columns) apply(x[, columns, drop = FALSE], 1, paste, collapse = "\034")
escape <- function(x) as.character(htmltools::htmlEscape(x))
genome_study <- function(description) {
  # Both the cited study and its explicit assay must support genome-wide evidence.
  grepl("(Chiu et al. \\(2023\\)|Nguyen et al. \\(2025\\)|Zheng et al. \\(2023\\)|Techer et al. \\(2022\\))", description) &
    grepl("\\bWGS\\b|RAD-seq", description)
}

load_map_data <- function(apply_reviews = TRUE) {
  u <- "Data/updates/2026-11-05"
  points <- read_evidence("Data/mappingpoints_Varroareview05022020.csv")
  countries <- read_evidence("Data/mappingcountry_Varroareview05022020.csv")
  additions <- list(P = read_evidence(file.path(u, "point_additions.csv")),
                    C = read_evidence(file.path(u, "country_additions.csv")))
  crosswalk <- read_evidence(file.path(u, "workbook_crosswalk.csv"))
  prepare <- function(data, kind) {
    # Match entire supplied rows, so study labels never leak between coincident records.
    match_row <- match(row_key(data, names(data)), row_key(additions[[kind]], names(data)))
    input <- paste0(kind, match_row)
    lookup <- match(input, crosswalk$input)
    data$record_id <- paste0(kind, seq_len(nrow(data)))
    data$is_new <- !is.na(match_row)
    data$input_id <- ifelse(data$is_new, input, "")
    data$reported_mt <- data$Haplogroup
    data$reported_mt[!is.na(lookup)] <- crosswalk$reported_mt[lookup[!is.na(lookup)]]
    data$reference <- sub(".*Ref:", "", data$Description)
    data$reference[!is.na(lookup)] <- crosswalk$reference[lookup[!is.na(lookup)]]
    data$nuclear <- genome_study(data$Description)
    data$archive_note <- ""
    if (kind == "C") {
      data$Region <- sub("\\. .*", "", data$Description)
      data$Region[!is.na(lookup)] <- crosswalk$region[lookup[!is.na(lookup)]]
    }
    data
  }
  points <- prepare(points, "P")
  countries <- prepare(countries, "C")
  archives <- read_evidence(file.path(u, "archive_annotations.csv"))
  links <- read_evidence(file.path(u, "archive_legacy_links.csv"))
  for (i in seq_len(nrow(links))) {
    link <- links[i, ]
    j <- as.integer(link$point_data_row)
    archive <- archives[as.integer(sub("A", "", link$archive_input)), ]
    # A reviewed locality/host association is not evidence of the same individual mite.
    stopifnot(points$Description[j] == link$legacy_description,
              points$Region[j] == link$legacy_region, points$Host[j] == link$host)
    note <- paste0("<div class='archive-note'><b>Separately attributed archived WGS evidence (",
      link$archive_input, "; legacy S2 row ", link$s2_row, ")</b><br>",
      escape(archive$Description), "<br><b>Archive reference coordinates:</b> ",
      archive$coord.X, " N, ", archive$coord.Y, " E (approximate).<br><b>Review:</b> ",
      escape(link$review), ". Locality and collection host matched; individual reuse is unresolved.</div>")
    points$archive_note[j] <- paste0(points$archive_note[j], note)
    points$nuclear[j] <- TRUE
  }
  points$coord.X <- as.numeric(points$coord.X) # X is latitude in the historical files.
  points$coord.Y <- as.numeric(points$coord.Y) # Y is longitude, despite the usual GIS convention.
  stopifnot(all(is.finite(points$coord.X)), all(abs(points$coord.X) <= 90),
            all(is.finite(points$coord.Y)), all(abs(points$coord.Y) <= 180))
  points$coordinate_key <- paste(points$coord.X, points$coord.Y, sep = ",")
  # This lookup affects polygon display only; the archival country spelling is retained.
  aliases <- c("Republic of Korea" = "Korea, Republic of", "South Korea" = "Korea, Republic of")
  countries$border_name <- trimws(countries$Location)
  matched <- countries$border_name %in% names(aliases)
  countries$border_name[matched] <- unname(aliases[countries$border_name[matched]])
  world <- sf::st_read("Raster_borders/TM_WORLD_BORDERS_SIMPL-0.3.shp", quiet = TRUE)
  world <- sf::st_transform(world, 4326)
  # Manual decisions are exported from the review log by build_resource.py.
  add_review <- function(rows) {
    rows$verification_status <- "not_verified"
    rows$verified_by <- rows$verified_at <- rows$verification_note <- rows$fingerprint <- ""
    rows$publication_status <- "published"
    if (apply_reviews && file.exists("Data/curation/map_review.json")) {
      reviews <- jsonlite::fromJSON("Data/curation/map_review.json")
      index <- match(rows$record_id, reviews$record_id)
      for (key in setdiff(names(reviews), "record_id")) {
        rows[[key]][!is.na(index)] <- reviews[[key]][index[!is.na(index)]]
      }
      binding_path <- "Data/curation/map_review_inputs.json"
      current <- FALSE
      if (file.exists(binding_path)) {
        binding <- jsonlite::fromJSON(binding_path)
        current <- all(vapply(names(binding), function(path) {
          file.exists(path) && digest::digest(file = path, algo = "sha256") == binding[[path]]
        }, logical(1)))
      }
      if (!current) {
        rows$verification_status[rows$verification_status == "verified"] <- "needs_recheck"
        rows$fingerprint <- ""
        warning("Map review metadata is stale. Rebuild with scripts/build_site.sh before publishing.")
      }
      rows <- rows[rows$publication_status == "published", ]
    }
    rows
  }
  points <- add_review(points)
  countries <- add_review(countries)
  list(points = points, countries = countries, world = world, archives = archives, links = links)
}

# Stable colors retain the original mitochondrial families; study-specific labels stay distinct.
group_colors <- c(
  VD_K_type = "#e41a1c", VD_Japan_J1 = "#0066ff", VD_J_type = "#3875b9",
  KoreaJapan = "#9707e7", VD_Taiwan_T = "#008b8b", VD_J2_Lin2021 = "#6b58a5",
  VD_C4_Lin2021 = "#986545", VD_China_C1 = "#ff9933", VD_China_C2 = "#b800e6",
  VD_China_C3 = "#ff4dff", VD_China_C4 = "#663300", VD_Nepal_1 = "#993300",
  VD_Nepal_2 = "#af7183", VD_South_India_1 = "#b29800", VD_Sri_Lanka_1 = "#669999",
  VD_Viet_Nam_V1 = "#009900", VJ_Malaysia_1 = "#4dffff", VJ_Malaysia_2 = "#0099ff",
  VJ_Java_1 = "#0000e6", VJ_Ambon_1 = "#000000", VJ_Lombok_1 = "#00aa00",
  VJ_Bali_1 = "#006600", VJ_Bengaluru_1 = "#006666", VJ_Sumbawa_1 = "#ff8000",
  VJ_Sumatra_1 = "#d1a17b", VJ_Flores_1 = "#c5b600", VJ_Samui_1 = "#a64dff",
  VJ_Samui_2 = "#bda1cf", VJ_Borneo_1 = "#663300", VJ_Borneo_2 = "#896a4b",
  VJ_North_Thailand_1 = "#888888", VJ_North_Thailand_2 = "#666666",
  VJ_North_Thailand_3 = "#4d4d4d", VJ_Laos_L1 = "#cc0066", VJ_Papua_New_Guinea_1 = "#345c2c",
  VSP_Los_Banos_1 = "#333333", VSP_Luzon_1 = "#111111", VSP_Luzon_2 = "#555555", VSP_Mindanao = "#777777")
group_label <- function(group) {
  labels <- c(VD_K_type = "V. destructor K group", VD_Japan_J1 = "V. destructor J1",
    VD_J_type = "V. destructor J type (Hua 2023)", VD_Taiwan_T = "V. destructor T (Hua 2023)",
    VD_J2_Lin2021 = "V. destructor J2-1 (Lin 2021)", VD_C4_Lin2021 = "V. destructor C4-1 (Lin 2021)",
    VD_Nepal_2 = "V. destructor Nepal2 (Techer 2022)", KoreaJapan = "V. destructor K and J")
  fallback <- gsub("_", " ", sub("^VJ_", "V. jacobsoni ", sub("^VD_", "V. destructor ", group)))
  fallback <- sub("^VU ", "V. underwoodi ", sub("^VR ", "V. rindereri ", sub("^VSP ", "Varroa sp. ", fallback)))
  ifelse(group %in% names(labels), unname(labels[group]), fallback)
}

evidence_html <- function(row, country = FALSE) {
  year <- ifelse(row$Year %in% c("", "NA"), "unavailable", row$Year)
  unresolved <- row$GROUP == "VD_nuclear_evidence" || !nzchar(row$Haplogroup)
  mt <- if (unresolved) "unresolved / assignment withheld" else row$reported_mt
  precision <- if (country) "country polygon; named region only" else
    if (row$Coord.type == "exact") "published site coordinates" else "approximate locality"
  stamp <- if (row$is_new) "Added 2026" else "2021 baseline"
  paste0("<details class='evidence-record'><summary>", escape(paste(row$record_id, stamp, row$Host,
      year, row$reference, sep = " · ")), "</summary><p><b>", escape(row$Species), "</b><br>",
      "<b>Collection host:</b> ", escape(row$Host), "<br><b>Collection year:</b> ", escape(year),
      "<br><b>Locality:</b> ", escape(paste(row$Region, row$Location, sep = ", ")),
      "<br><b>Geographic precision:</b> ", precision,
      "<br><b>Reported mt label:</b> ", escape(mt),
      "<br><b>Manual verification:</b> ",
      if (row$verification_status == "verified") paste0("Manually verified by ", escape(row$verified_by), " · ", escape(row$verified_at)) else
        if (row$verification_status == "needs_recheck") "Needs recheck after a record change" else "Not yet verified",
      if (unresolved && nzchar(row$reported_mt)) paste0("<br><b>Unresolved COI report:</b> ", escape(row$reported_mt)) else "",
      "<br><b>Study and source evidence:</b> ", escape(row$Description), "</p>",
      row$archive_note, "</details>")
}

shared_popup <- function(data, country = FALSE) {
  # Every coincident record, including other hosts and studies, remains separately expandable.
  data <- data[order(!data$is_new), ] # Put this update first, with archival context still available.
  title <- if (country) "Country evidence" else "Evidence at this coordinate"
  paste0("<div class='evidence-popup'><b>", title, ": ", nrow(data), " records</b>",
    if (country) "<p>A polygon indicates occurrence in the named region, not uniform distribution across the country.</p>" else
      "<p>Open each study below. Shared coordinates do not establish shared specimens.</p>",
    paste(vapply(seq_len(nrow(data)), function(i) evidence_html(data[i, ], country), character(1)), collapse = ""), "</div>")
}

## ---- resource-explorer-function
build_explorer <- function(data) {
  # Export display metadata alongside the untouched original fields for browser-side filtering.
  records <- c(lapply(seq_len(nrow(data$points)), function(i) {
    row <- as.list(data$points[i, ])
    row$evidence_level <- "point"
    row
  }), lapply(seq_len(nrow(data$countries)), function(i) {
    row <- as.list(data$countries[i, ])
    row$evidence_level <- "country"
    row
  }))
  geojson <- tempfile(fileext = ".geojson")
  sf::st_write(data$world[, "NAME", drop = FALSE], geojson, driver = "GeoJSON", quiet = TRUE)
  world <- jsonlite::fromJSON(geojson, simplifyVector = FALSE)
  references <- read_evidence("Data/updates/2026-11-05/reference_links.csv")
  groups <- sort(unique(c(data$points$GROUP, data$countries$GROUP)))
  colors <- group_colors[groups]
  # Less common species and unresolved labels still have a visible, neutral display color.
  colors[is.na(colors)] <- "#52646d"
  names(colors) <- groups
  labels <- setNames(group_label(groups), groups)
  # A restrained palette for the atlas; archival host maps keep their original colors.
  atlas_colors <- c(VD_K_type = "#c34b47", VD_Japan_J1 = "#386ca3", VD_J_type = "#598bb4",
    KoreaJapan = "#8b609b", VD_Taiwan_T = "#168c86", VD_J2_Lin2021 = "#7463a4",
    VD_C4_Lin2021 = "#9b7048", VD_China_C1 = "#dc943e", VD_China_C2 = "#bd6091",
    VD_China_C3 = "#ce8aa9", VD_China_C4 = "#805b43", VD_Viet_Nam_V1 = "#4c9060",
    VD_Nepal_1 = "#a56a44", VD_Nepal_2 = "#b87d87", VD_South_India_1 = "#a39135",
    VJ_Malaysia_1 = "#46a5ac", VJ_Malaysia_2 = "#4089b9", VJ_Java_1 = "#425c9b",
    VJ_Lombok_1 = "#559761", VJ_Bali_1 = "#367950", VJ_Sumbawa_1 = "#d38b42",
    VJ_Samui_1 = "#9673ac", VJ_Laos_L1 = "#b75c83")
  colors[names(atlas_colors)] <- atlas_colors
  leaflet::leaflet(height = 560, options = leaflet::leafletOptions(
      worldCopyJump = TRUE, zoomSnap = 0.25, zoomDelta = 0.5, minZoom = 0)) |>
    leaflet::setView(lng = 108, lat = 24, zoom = 3) |>
    htmlwidgets::onRender(paste(readLines("scripts/resource_explorer.js", warn = FALSE), collapse = "\n"),
      data = list(records = records, world = world, colors = as.list(colors), labels = as.list(labels),
        references = lapply(seq_len(nrow(references)), function(i) as.list(references[i, ]))))
}

build_map <- function(data, hosts, species, new_only = FALSE, center = c(0, 15, 2)) {
  points <- subset(data$points, Host %in% hosts & Species %in% species)
  countries <- subset(data$countries, Host %in% hosts & Species %in% species)
  if (new_only) {
    points <- subset(points, is_new)
    countries <- subset(countries, is_new)
  }
  mt_points <- subset(points, GROUP != "VD_nuclear_evidence" & nzchar(Haplogroup))
  mt_countries <- subset(countries, GROUP != "VD_nuclear_evidence" & nzchar(Haplogroup))
  groups <- sort(unique(c(mt_points$GROUP, mt_countries$GROUP)))
  stopifnot(all(groups %in% names(group_colors)))
  point_popups <- lapply(split(data$points, data$points$coordinate_key), shared_popup)
  country_popups <- lapply(split(data$countries, data$countries$border_name), shared_popup, country = TRUE)
  m <- leaflet::leaflet(options = leaflet::leafletOptions(preferCanvas = FALSE), height = 620) |>
    # Bundled borders provide a usable base even when external tile services change.
    leaflet::addPolygons(data = data$world, group = "Country outlines (offline)",
      color = "#bbc6c8", weight = 0.6, fillColor = "#f7f5ef", fillOpacity = 1,
      options = leaflet::pathOptions(interactive = FALSE)) |>
    leaflet::addTiles(group = "OpenStreetMap") |>
    leaflet::setView(lng = center[1], lat = center[2], zoom = center[3])
  add_points <- function(map, rows, color, layer) {
    if (!nrow(rows)) return(map)
    for (precision in unique(rows$Coord.type)) {
      q <- rows[rows$Coord.type == precision, ]
      q <- q[!duplicated(q$coordinate_key), ]
      # Filled circles distinguish published coordinates; hollow circles mark locality proxies.
      map <- leaflet::addCircleMarkers(map, data = q, lng = ~coord.Y, lat = ~coord.X,
        radius = 5.5, color = color, weight = 2, fill = TRUE,
        fillColor = if (precision == "exact") color else "white",
        fillOpacity = if (precision == "exact") 0.85 else 0.55,
        popup = unname(vapply(q$coordinate_key, function(k) point_popups[[k]], character(1))),
        label = paste(q$Region, q$Host, sep = " · "), group = layer,
        popupOptions = leaflet::popupOptions(maxWidth = 530, maxHeight = 360))
    }
    map
  }
  add_countries <- function(map, rows, color, layer, nuclear = FALSE) {
    if (!nrow(rows)) return(map)
    polygons <- data$world[data$world$NAME %in% rows$border_name, ]
    if (!nrow(polygons)) return(map)
    leaflet::addPolygons(map, data = polygons, group = layer, color = color,
      weight = if (nuclear) 3 else 1, opacity = 0.75,
      dashArray = if (nuclear) "5,5" else NULL, fillColor = color,
      fillOpacity = if (nuclear) 0.05 else 0.12,
      popup = unname(vapply(polygons$NAME, function(k) country_popups[[k]], character(1))),
      label = polygons$NAME, popupOptions = leaflet::popupOptions(maxWidth = 530, maxHeight = 360))
  }
  point_layers <- country_layers <- character()
  for (g in groups) {
    point_layer <- paste0("Points: ", group_label(g))
    country_layer <- paste0("Countries: ", group_label(g))
    p <- mt_points[mt_points$GROUP == g, ]
    c <- mt_countries[mt_countries$GROUP == g, ]
    m <- add_countries(m, c, group_colors[[g]], country_layer)
    m <- add_points(m, p, group_colors[[g]], point_layer)
    if (nrow(p)) point_layers <- c(point_layers, point_layer)
    if (nrow(c)) country_layers <- c(country_layers, country_layer)
  }
  nuclear_layer <- "Genome-wide evidence (WGS / RAD-seq)"
  m <- add_countries(m, subset(countries, nuclear), "#5b626b", nuclear_layer, TRUE)
  m <- add_points(m, subset(points, nuclear), "#5b626b", nuclear_layer)
  m <- leaflet::addLayersControl(m, position = "topright",
    baseGroups = c("Country outlines (offline)", "OpenStreetMap"),
    overlayGroups = c(point_layers, country_layers, nuclear_layer),
    options = leaflet::layersControlOptions(collapsed = TRUE)) |>
    leaflet::hideGroup("OpenStreetMap") |>
    leaflet::hideGroup(nuclear_layer)
  legend <- paste0("<details class='map-legend'><summary><b>Lineages and symbols</b></summary>",
    "<div>● published site coordinates<br>○ approximate locality<br>Shading: country evidence<br>",
    "Gray: optional genome-wide evidence</div><hr>",
    paste0("<div><span style='color:", unname(group_colors[groups]), "'>●</span> ",
      escape(group_label(groups)), "</div>", collapse = ""), "</details>")
  m <- leaflet::addControl(m, html = legend, position = "bottomleft")
  if (new_only) {
    # A record finder makes all additions accessible, including coincident points and country-only evidence.
    records <- lapply(seq_len(nrow(points)), function(i) {
      p <- points[i, ]
      list(id = p$input_id, label = paste(p$Location, p$Region, p$Host, p$reference, p$input_id, sep = " · "),
        layer = if (p$GROUP == "VD_nuclear_evidence") nuclear_layer else paste0("Points: ", group_label(p$GROUP)),
        lat = p$coord.X, lng = p$coord.Y, popup = point_popups[[p$coordinate_key]])
    })
    for (i in seq_len(nrow(countries))) {
      p <- countries[i, ]
      bbox <- sf::st_bbox(data$world[data$world$NAME == p$border_name, ])
      records[[length(records) + 1]] <- list(id = p$input_id,
        label = paste(p$Location, p$Region, p$Host, p$reference, "country evidence", sep = " · "),
        layer = paste0("Countries: ", group_label(p$GROUP)),
        bounds = list(c(unname(bbox["ymin"]), unname(bbox["xmin"])), c(unname(bbox["ymax"]), unname(bbox["xmax"]))),
        popup = country_popups[[p$border_name]])
    }
    choices <- paste(vapply(records, function(r) paste0("<option value='", r$id, "'>", escape(r$label), "</option>"), character(1)), collapse = "")
    m <- leaflet::addControl(m, html = paste0("<label class='record-finder'>Find added evidence<select aria-label='Find added evidence'>",
      "<option value=''>Choose a study record</option>", choices, "</select></label>"), position = "topleft")
    m <- htmlwidgets::onRender(m, "function(el, x, data) {
      var map = this, select = el.querySelector('.record-finder select');
      L.DomEvent.disableClickPropagation(select);
      L.DomEvent.disableScrollPropagation(select);
      select.addEventListener('change', function() {
        var record = data.records.find(function(r) { return r.id === select.value; });
        if (!record) return;
        map.layerManager.getLayerGroup(record.layer, true).addTo(map);
        if (record.bounds) map.fitBounds(record.bounds);
        else map.setView([record.lat, record.lng], 7);
        L.popup({maxWidth: 530, maxHeight: 360}).setLatLng(record.bounds ? map.getCenter() : [record.lat, record.lng])
          .setContent(record.popup).openOn(map);
      });
    }", data = list(records = records))
  }
  m
}
