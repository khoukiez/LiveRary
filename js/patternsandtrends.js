
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ9imbGQ0CeCoRA86oXlFsnl1x1VYAP5uN0pwlbMPxdxWqGTmZXd27D-OOANZrF-HN2zlAv0iDoHP2V/pub?gid=1703424583&single=true&output=csv";

const weekdays = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday"
];

let allRecords = [];
let isLoading = false;

const weekdaySelect = document.getElementById("weekday-select");
const floorSelect = document.getElementById("floor-select");
const areaSelect = document.getElementById("area-select");
const timeSelect = document.getElementById("time-select");
const statusText = document.getElementById("data-status");
const refreshButton = document.getElementById("refresh-button");

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

/* Keeps only the latest observation per area.
   Used for summary cards only. */

function latestPerArea(records) {
    const latest = new Map();

    records.forEach(record => {
        const key =
            `${record.day}|${record.floor}|${record.name.toLowerCase()}`;

        const previous = latest.get(key);

        if (
            !previous ||
            timeToMinutes(record.time) > timeToMinutes(previous.time) ||
            (
                timeToMinutes(record.time) === timeToMinutes(previous.time) &&
                record.order > previous.order
            )
        ) {
            latest.set(key, record);
        }
    });

    return [...latest.values()];
}

/* Filters all records for the table. */

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

/* Filters latest observations for the summary cards. */

function getFilteredRecords() {
    return getAllFilteredRecords()
        .filter(record =>
            latestPerArea(allRecords).some(latest =>
                latest.day === record.day &&
                latest.floor === record.floor &&
                latest.name === record.name &&
                latest.time === record.time &&
                latest.order === record.order
            )
        );
}

function occupancy(record) {
    return record.percentage;
}

function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}

function renderSummary(records) {
    const availableRecords = records.filter(record =>
        occupancy(record) !== null
    );

    if (!availableRecords.length) {
        setText("average-occupancy", "—");
        setText("busiest-area", "—");
        setText("busiest-detail", "No data available");
        setText("freest-area", "—");
        setText("freest-detail", "No data available");
        setText("areas-count", records.length);
        return;
    }

    const average = availableRecords.reduce((sum, record) =>
        sum + occupancy(record), 0
    ) / availableRecords.length;

    const busiest = availableRecords.reduce((best, record) =>
        occupancy(record) > occupancy(best) ? record : best
    );

    const freest = availableRecords.reduce((best, record) =>
        occupancy(record) < occupancy(best) ? record : best
    );

    setText("average-occupancy", `${average.toFixed(1)}%`);
    setText("busiest-area", busiest.name);

    setText(
        "busiest-detail",
        `Floor ${busiest.floor} · ${occupancy(busiest).toFixed(1)}% occupied`
    );

    setText("freest-area", freest.name);

    setText(
        "freest-detail",
        `Floor ${freest.floor} · ${occupancy(freest).toFixed(1)}% occupied`
    );

    setText("areas-count", records.length);
}

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

/* Displays every observation, including time. */

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

function renderPage() {
    const summaryRecords = getFilteredRecords();
    const tableRecords = getAllFilteredRecords();

    renderSummary(summaryRecords);
    renderWeekdayChart();
    renderTable(tableRecords);

    statusText.textContent =
        `${tableRecords.length} observations displayed · ${allRecords.length} source observations loaded`;
}

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
