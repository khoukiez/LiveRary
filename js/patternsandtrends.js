
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ9imbGQ0CeCoRA86oXlFsnl1x1VYAP5uN0pwlbMPxdxWqGTmZXd27D-OOANZrF-HN2zlAv0iDoHP2V/pub?gid=1703424583&single=true&output=csv";

const weekdays = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday"
];

let allRecords = [];
let isLoading = false;

const weekdaySelect = document.getElementById("weekday-select");
const floorSelect = document.getElementById("floor-select");
const areaSelect = document.getElementById("area-select");
const timeSelect = document.getElementById("time-select");
const statusText = document.getElementById("data-status");
const refreshButton = document.getElementById("refresh-button");

/* ==============================
   CSV PROCESSING
============================== */

function parseCSV(csv) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let i = 0; i < csv.length; i++) {
        const char = csv[i];

        if (char === '"') {
            if (quoted && csv[i + 1] === '"') {
                field += '"';
                i++;
            } else {
                quoted = !quoted;
            }
        } else if (char === "," && !quoted) {
            row.push(field.trim());
            field = "";
        } else if ((char === "\n" || char === "\r") && !quoted) {
            if (char === "\r" && csv[i + 1] === "\n") i++;

            row.push(field.trim());

            if (row.some(value => value !== "")) {
                rows.push(row);
            }

            row = [];
            field = "";
        } else {
            field += char;
        }
    }

    row.push(field.trim());

    if (row.some(value => value !== "")) {
        rows.push(row);
    }

    return rows;
}

function parseNumber(value) {
    if (value === undefined || value === null || value.trim() === "") {
        return null;
    }

    const number = Number(value.replace(/,/g, ""));

    return Number.isFinite(number) ? number : null;
}

function parsePercentage(value) {
    if (value === undefined || value === null || value.trim() === "") {
        return null;
    }

    const number = Number(value.replace("%", "").trim());

    if (!Number.isFinite(number) || number < 0) {
        return null;
    }

    return number;
}

/* ==============================
   TIME FORMATTING
============================== */

function timeToMinutes(time) {
    if (!time) return -1;

    const value = String(time).trim();

    const match = value.match(
        /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i
    );

    if (!match) return -1;

    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const period = match[3]?.toUpperCase();

    if (minutes > 59) return -1;

    if (period) {
        if (hours < 1 || hours > 12) return -1;

        if (period === "AM" && hours === 12) hours = 0;
        if (period === "PM" && hours !== 12) hours += 12;
    } else if (hours > 23) {
        return -1;
    }

    return hours * 60 + minutes;
}

function normalizeTime(time) {
    const minutes = timeToMinutes(time);

    if (minutes < 0) return "";

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return `${String(hours).padStart(2, "0")}:${String(remainingMinutes).padStart(2, "0")}`;
}

function formatTime(time) {
    const minutes = timeToMinutes(time);

    if (minutes < 0) return time;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    const period = hours >= 12 ? "PM" : "AM";
    const displayHour = hours % 12 || 12;

    return `${displayHour}:${String(remainingMinutes).padStart(2, "0")} ${period}`;
}

/* ==============================
   FETCH GOOGLE SHEETS DATA
============================== */

async function fetchRecords() {
    const response = await fetch(CSV_URL, {
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error(`CSV request failed: ${response.status}`);
    }

    const rows = parseCSV(await response.text());

    if (rows.length < 2) {
        throw new Error("No records were found in the spreadsheet.");
    }

    const headers = rows[0].map(value =>
        value.trim().replace(/^\uFEFF/, "").toLowerCase()
    );

    const col = name => headers.indexOf(name.toLowerCase());

    const weekdayIndex = col("Weekday");
    const timeIndex = col("Time Recorded");
    const floorIndex = col("Floor");
    const areaIndex = col("Study Area");
    const totalIndex = col("Total Seats");
    const occupiedIndex = col("Occupied Seats");
    const percentageIndex = col("Occupancy Percentage");

    const indexes = [
        weekdayIndex,
        timeIndex,
        floorIndex,
        areaIndex,
        totalIndex,
        occupiedIndex,
        percentageIndex
    ];

    if (indexes.some(index => index === -1)) {
        throw new Error(
            `Check the CSV column headers. Found: ${headers.join(", ")}`
        );
    }

    let previousWeekday = "";

    return rows.slice(1)
        .map((row, index) => {
            const weekday = (row[weekdayIndex] || "").trim();

            if (weekday) {
                previousWeekday = weekday;
            }

            return {
                day: previousWeekday,
                time: normalizeTime(row[timeIndex]),
                floor: Number(row[floorIndex]),
                name: (row[areaIndex] || "").trim(),
                total: parseNumber(row[totalIndex]),
                occupied: parseNumber(row[occupiedIndex]),
                percentage: parsePercentage(row[percentageIndex]),
                order: index
            };
        })
        .filter(record => {
            const validWeekday = weekdays.some(day =>
                day.toLowerCase() === record.day.toLowerCase()
            );

            return (
                validWeekday &&
                record.time &&
                Number.isInteger(record.floor) &&
                record.floor >= 1 &&
                record.name
            );
        })
        .map(record => ({
            ...record,
            day: weekdays.find(day =>
                day.toLowerCase() === record.day.toLowerCase()
            )
        }));
}

/* ==============================
   FILTER RECORDS
============================== */

function getAllFilteredRecords() {
    let records = [...allRecords];

    if (weekdaySelect.value !== "All") {
        records = records.filter(record =>
            record.day === weekdaySelect.value
        );
    }

    if (floorSelect.value !== "All") {
        records = records.filter(record =>
            record.floor === Number(floorSelect.value)
        );
    }

    return records;
}

/* ==============================
   GENERAL HELPERS
============================== */

function occupancy(record) {
    return record.percentage;
}

function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}

/* ==============================
   SUMMARY CARDS
============================== */

function renderSummary(records) {

    // Only records with valid occupancy percentages
    // can be used to identify the quietest and busiest periods.

    const occupancyRecords = records.filter(record =>
        occupancy(record) !== null
    );

    // Unique study areas, identified by floor and area name.

    const uniqueAreas = new Set(
        records.map(record =>
            `${record.floor}|${record.name.toLowerCase()}`
        )
    );

    // Valid seat records for average available seats.

    const validSeatRecords = records.filter(record =>
        record.total !== null &&
        record.occupied !== null &&
        record.total > 0 &&
        record.occupied >= 0 &&
        record.occupied <= record.total
    );

    /* AREAS RECORDED */

    setText("areas-count", uniqueAreas.size);

    setText(
        "areas-detail",
        uniqueAreas.size === 1
            ? "Unique study area"
            : "Unique study areas"
    );

    /* NO RECORDS */

    if (records.length === 0) {
        setText("quietest-time", "—");
        setText("quietest-detail", "No observations available");

        setText("busiest-time", "—");
        setText("busiest-detail", "No observations available");

        setText("average-available-seats", "—");
        setText("average-available-detail", "No valid seat records");

        return;
    }

    /* QUIETEST AND BUSIEST TIME */

    if (occupancyRecords.length === 0) {
        setText("quietest-time", "—");
        setText("quietest-detail", "No occupancy percentages available");

        setText("busiest-time", "—");
        setText("busiest-detail", "No occupancy percentages available");
    } else {

        const quietest = occupancyRecords.reduce((best, record) =>
            occupancy(record) < occupancy(best) ? record : best
        );

        const busiest = occupancyRecords.reduce((best, record) =>
            occupancy(record) > occupancy(best) ? record : best
        );

        setText(
            "quietest-time",
            formatTime(quietest.time)
        );

        setText(
            "quietest-detail",
            `${quietest.day} · Floor ${quietest.floor} · ${quietest.name} · ${occupancy(quietest).toFixed(1)}% occupied`
        );

        setText(
            "busiest-time",
            formatTime(busiest.time)
        );

        setText(
            "busiest-detail",
            `${busiest.day} · Floor ${busiest.floor} · ${busiest.name} · ${occupancy(busiest).toFixed(1)}% occupied`
        );
    }

    /* AVERAGE AVAILABLE SEATS */

    if (validSeatRecords.length === 0) {
        setText("average-available-seats", "—");
        setText("average-available-detail", "No valid seat records");

        return;
    }

    const totalAvailableSeats = validSeatRecords.reduce(
        (sum, record) => sum + (record.total - record.occupied),
        0
    );

    const averageAvailableSeats =
        totalAvailableSeats / validSeatRecords.length;

    setText(
        "average-available-seats",
        `${averageAvailableSeats.toFixed(1)} seats`
    );

    setText(
        "average-available-detail",
        `Across ${validSeatRecords.length} valid observations`
    );
}

/* ==============================
   STUDY AREA DROPDOWN
============================== */

function populateAreaSelect() {
    const previousValue = areaSelect.value;

    const names = [...new Set(
        allRecords.map(record =>
            `${record.floor}|${record.name}`
        )
    )].sort((a, b) => a.localeCompare(b));

    areaSelect.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a study area";
    areaSelect.appendChild(placeholder);

    names.forEach(key => {
        const [floor, ...nameParts] = key.split("|");
        const name = nameParts.join("|");

        const option = document.createElement("option");
        option.value = key;
        option.textContent = `Floor ${floor} · ${name}`;

        areaSelect.appendChild(option);
    });

    if (names.includes(previousValue)) {
        areaSelect.value = previousValue;
    } else if (names.length > 0) {
        areaSelect.selectedIndex = 1;
    }
}

/* ==============================
   OBSERVATION TIME DROPDOWN
============================== */

function populateTimeSelect() {
    const previousValue = timeSelect.value;

    const times = [...new Set(
        allRecords.map(record => record.time)
    )].sort((a, b) =>
        timeToMinutes(a) - timeToMinutes(b)
    );

    timeSelect.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select an observation time";
    timeSelect.appendChild(placeholder);

    times.forEach(time => {
        const option = document.createElement("option");

        option.value = time;
        option.textContent = formatTime(time);

        timeSelect.appendChild(option);
    });

    if (times.includes(previousValue)) {
        timeSelect.value = previousValue;
    } else if (times.length > 0) {
        timeSelect.value = times[0];
    }
}

/* ==============================
   WEEKDAY COMPARISON CHART
============================== */

function renderWeekdayChart() {
    const container = document.getElementById("weekday-chart");
    const note = document.getElementById("trend-note");

    container.replaceChildren();

    const areaKey = areaSelect.value;
    const selectedTime = timeSelect.value;

    if (!areaKey || !selectedTime) {
        container.innerHTML =
            '<p class="empty-state">Select a study area and observation time to compare occupancy.</p>';

        note.textContent = "";
        return;
    }

    const [floor, ...nameParts] = areaKey.split("|");
    const name = nameParts.join("|");

    const values = weekdays.map(day => {
        const record = allRecords.find(item =>
            item.day === day &&
            item.floor === Number(floor) &&
            item.name === name &&
            item.time === selectedTime
        );

        return {
            day,
            record,
            percent: record ? occupancy(record) : null
        };
    });

    values.forEach(item => {
        const column = document.createElement("div");
        column.className = "weekday-column";

        const value = document.createElement("span");
        value.className = "weekday-value";

        value.textContent = item.percent !== null
            ? `${item.percent.toFixed(1)}%`
            : "—";

        const track = document.createElement("div");
        track.className = "weekday-track";

        const fill = document.createElement("div");
        fill.className = "weekday-fill";

        fill.style.height = item.percent !== null
            ? `${Math.min(item.percent, 100)}%`
            : "0%";

        if (item.percent !== null) {
            fill.title =
                `${item.day}: ${item.percent.toFixed(1)}%`;
        }

        track.appendChild(fill);

        const label = document.createElement("span");
        label.className = "weekday-label";
        label.textContent = item.day.slice(0, 3);

        column.append(value, track, label);
        container.appendChild(column);
    });

    const availableValues = values.filter(item =>
        item.percent !== null
    );

    if (availableValues.length < 2) {
        note.textContent =
            `Showing ${formatTime(selectedTime)} comparisons. At least two weekdays with recorded occupancy percentages are needed for comparison.`;

        return;
    }

    const highest = availableValues.reduce((a, b) =>
        a.percent > b.percent ? a : b
    );

    const lowest = availableValues.reduce((a, b) =>
        a.percent < b.percent ? a : b
    );

    note.textContent =
        `At ${formatTime(selectedTime)}, the highest recorded occupancy was on ${highest.day} (${highest.percent.toFixed(1)}%), while the lowest was on ${lowest.day} (${lowest.percent.toFixed(1)}%). Missing bars indicate unavailable data.`;
}

/* ==============================
   COMPLETE OCCUPANCY TABLE
============================== */

function renderTable(records) {
    const tbody = document.getElementById("records-table");
    tbody.replaceChildren();

    if (!records.length) {
        const row = tbody.insertRow();
        const cell = row.insertCell();

        cell.colSpan = 7;
        cell.textContent = "No records match your selection.";

        return;
    }

    records.forEach(record => {
        const row = tbody.insertRow();

        const available =
            record.total !== null &&
            record.occupied !== null &&
            record.total > 0 &&
            record.occupied >= 0 &&
            record.occupied <= record.total
                ? record.total - record.occupied
                : null;

        const values = [
            record.day,
            formatTime(record.time),
            `Floor ${record.floor}`,
            record.name,
            record.occupied !== null ? record.occupied : "—",
            available !== null ? available : "—",
            record.percentage !== null
                ? `${record.percentage.toFixed(1)}%`
                : "No available data"
        ];

        values.forEach(value => {
            const cell = row.insertCell();
            cell.textContent = value;
        });
    });
}

/* ==============================
   RENDER COMPLETE PAGE
============================== */

function renderPage() {
    const filteredRecords = getAllFilteredRecords();

    renderSummary(filteredRecords);
    renderWeekdayChart();
    renderTable(filteredRecords);

    statusText.textContent =
        `${filteredRecords.length} observations displayed · ${allRecords.length} source observations loaded`;
}

/* ==============================
   REFRESH DATA
============================== */

async function loadData() {
    if (isLoading) return;

    isLoading = true;
    refreshButton.disabled = true;

    statusText.textContent = "Loading Google Sheets data...";

    try {
        const records = await fetchRecords();

        allRecords = records;

        populateAreaSelect();
        populateTimeSelect();

        renderPage();

        const lastUpdated = new Intl.DateTimeFormat("en-PH", {
            timeZone: "Asia/Manila",
            hour: "numeric",
            minute: "2-digit",
            hour12: true
        }).format(new Date());

        statusText.textContent =
            `${getAllFilteredRecords().length} observations displayed · ` +
            `${allRecords.length} source observations loaded · ` +
            `Last refreshed: ${lastUpdated} PHT`;

    } catch (error) {
        console.error("Patterns and Trends error:", error);

        statusText.textContent =
            "Unable to load data. Check your internet connection and the published Google Sheet.";

        if (allRecords.length > 0) {
            renderPage();
            statusText.textContent += " Showing previously loaded data.";
        }
    } finally {
        isLoading = false;
        refreshButton.disabled = false;
    }
}

/* ==============================
   EVENT LISTENERS
============================== */

weekdaySelect.addEventListener("change", renderPage);
floorSelect.addEventListener("change", renderPage);

areaSelect.addEventListener("change", renderWeekdayChart);
timeSelect.addEventListener("change", renderWeekdayChart);

refreshButton.addEventListener("click", loadData);

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        loadData();
    }
});

loadData();
setInterval(loadData, 60000);
