
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ9imbGQ0CeCoRA86oXlFsnl1x1VYAP5uN0pwlbMPxdxWqGTmZXd27D-OOANZrF-HN2zlAv0iDoHP2V/pub?gid=1703424583&single=true&output=csv";

let floors = [];
let selectedFloor = 0;
let currentSnapshot = null;

const OBSERVATION_START = 450; // 7:30 AM
const OBSERVATION_END = 1050;  // 5:30 PM

function timeToMinutes(time) {
    if (!time) return -1;

    const value = String(time).trim();

    const military = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);

    if (military) {
        const hours = Number(military[1]);
        const minutes = Number(military[2]);

        if (hours > 23 || minutes > 59) return -1;

        return hours * 60 + minutes;
    }

    const standard = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);

    if (standard) {
        let hours = Number(standard[1]);
        const minutes = Number(standard[2]);
        const period = standard[3].toUpperCase();

        if (hours < 1 || hours > 12 || minutes > 59) return -1;

        if (period === "AM" && hours === 12) hours = 0;
        if (period === "PM" && hours !== 12) hours += 12;

        return hours * 60 + minutes;
    }

    return -1;
}

function normalizeTime(time) {
    const minutes = timeToMinutes(time);

    if (minutes < 0) return "";

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function formatTime(time) {
    const minutes = timeToMinutes(time);

    if (minutes < 0) return time;

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    return `${hours % 12 || 12}:${String(mins).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
}

function getPhilippineTime() {
    const now = new Date();

    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila",
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(now);

    const getPart = type =>
        parts.find(part => part.type === type)?.value;

    const weekday = getPart("weekday");
    const hour = Number(getPart("hour"));
    const minute = Number(getPart("minute"));
    const nowMinutes = hour * 60 + minute;

    const currentTime = new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
    }).format(now);

    const isWeekend =
        weekday === "Saturday" || weekday === "Sunday";

    let targetTime = null;

    if (!isWeekend && nowMinutes >= OBSERVATION_START) {
        const latestMinutes = Math.min(
            OBSERVATION_END,
            OBSERVATION_START +
            Math.floor((nowMinutes - OBSERVATION_START) / 60) * 60
        );

        targetTime = normalizeTime(
            `${Math.floor(latestMinutes / 60)}:${String(latestMinutes % 60).padStart(2, "0")}`
        );
    }

    return {
        weekday,
        currentTime,
        targetTime,
        isWeekend,
        nowMinutes
    };
}

function parseCSV(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];

        if (char === '"' && quoted && next === '"') {
            cell += '"';
            i++;
        } else if (char === '"') {
            quoted = !quoted;
        } else if (char === "," && !quoted) {
            row.push(cell.trim());
            cell = "";
        } else if ((char === "\n" || char === "\r") && !quoted) {
            if (char === "\r" && next === "\n") i++;

            row.push(cell.trim());

            if (row.some(value => value !== "")) rows.push(row);

            row = [];
            cell = "";
        } else {
            cell += char;
        }
    }

    row.push(cell.trim());

    if (row.some(value => value !== "")) rows.push(row);

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

    const hasPercentSign = value.includes("%");
    const number = Number(value.replace("%", "").trim());

    if (!Number.isFinite(number)) return null;

    return !hasPercentSign && number > 0 && number <= 1
        ? number * 100
        : number;
}

async function fetchOccupancyData() {
    const response = await fetch(CSV_URL);

    if (!response.ok) {
        throw new Error(`CSV request failed: ${response.status}`);
    }

    const rows = parseCSV(await response.text());

    if (rows.length < 2) {
        throw new Error("No occupancy records were found in the CSV.");
    }

    const headers = rows[0].map(value =>
        value.replace(/^\uFEFF/, "").trim().toLowerCase()
    );

    const column = name => headers.indexOf(name.toLowerCase());

    const weekdayIndex = column("Weekday");
    const timeIndex = column("Time Recorded");
    const floorIndex = column("Floor");
    const areaIndex = column("Study Area");
    const totalIndex = column("Total Seats");
    const occupiedIndex = column("Occupied Seats");
    const percentageIndex = column("Occupancy Percentage");

    const indexes = [
        weekdayIndex,
        timeIndex,
        floorIndex,
        areaIndex,
        totalIndex,
        occupiedIndex,
        percentageIndex
    ];

    if (indexes.some(index => index < 0)) {
        throw new Error(`Unexpected CSV headers: ${headers.join(", ")}`);
    }

    let lastWeekday = "";

    return rows.slice(1).map(row => {
        const weekday = row[weekdayIndex]?.trim();

        if (weekday) lastWeekday = weekday;

        return {
            weekday: lastWeekday,
            time: normalizeTime(row[timeIndex]?.trim()),
            floor: Number(row[floorIndex]),
            name: row[areaIndex]?.trim() || "",
            total: parseNumber(row[totalIndex]),
            occupied: parseNumber(row[occupiedIndex]),
            percentage: parsePercentage(row[percentageIndex])
        };
    }).filter(record =>
        record.weekday &&
        record.time &&
        Number.isInteger(record.floor) &&
        record.name
    );
}

function buildFloors(records, selectedWeekday, selectedTime) {
    if (!selectedTime) return [];

    const targetTime = timeToMinutes(selectedTime);
    const selectedDay = selectedWeekday.trim().toLowerCase();
    const latestRecords = new Map();

    records.filter(record =>
        record.weekday.trim().toLowerCase() === selectedDay &&
        timeToMinutes(record.time) <= targetTime
    ).forEach(record => {
        const key = `${record.floor}|${record.name.toLowerCase()}`;
        const previous = latestRecords.get(key);

        if (
            !previous ||
            timeToMinutes(record.time) > timeToMinutes(previous.time)
        ) {
            latestRecords.set(key, record);
        }
    });

    const floorMap = new Map();

    for (const record of latestRecords.values()) {
        if (!floorMap.has(record.floor)) {
            floorMap.set(record.floor, {
                name: `Floor ${record.floor}`,
                areas: []
            });
        }

        floorMap.get(record.floor).areas.push({
            name: record.name,
            occupied: record.occupied,
            total: record.total,
            percentage: record.percentage,
            time: record.time
        });
    }

    return [...floorMap.values()].sort((a, b) =>
        Number(a.name.match(/\d+/)?.[0]) -
        Number(b.name.match(/\d+/)?.[0])
    );
}

function updateSummary() {
    const overallOccupancy = document.getElementById("overall-occupancy");
    const overallProgress = document.getElementById("overall-progress");
    const seatSummary = document.getElementById("seat-summary");

    const busiestArea = document.getElementById("busiest-area");
    const busiestFloor = document.getElementById("busiest-floor");
    const busiestRate = document.getElementById("busiest-rate");

    const freestArea = document.getElementById("freest-area");
    const freestFloor = document.getElementById("freest-floor");
    const freestRate = document.getElementById("freest-rate");

    let occupiedTotal = 0;
    let seatTotal = 0;
    let busiest = null;
    let freest = null;

    floors.forEach(floor => {
        floor.areas.forEach(area => {
            if (
                area.total !== null &&
                area.occupied !== null &&
                area.total > 0 &&
                area.occupied >= 0 &&
                area.occupied <= area.total
            ) {
                occupiedTotal += area.occupied;
                seatTotal += area.total;
            }

            if (area.percentage !== null) {
                const item = {
                    ...area,
                    floor: floor.name,
                    rate: area.percentage
                };

                if (!busiest || item.rate > busiest.rate) {
                    busiest = item;
                }

                if (!freest || item.rate < freest.rate) {
                    freest = item;
                }
            }
        });
    });

    const overallPercentage = seatTotal > 0
        ? (occupiedTotal / seatTotal) * 100
        : null;

    overallOccupancy.textContent = overallPercentage !== null
        ? `${overallPercentage.toFixed(1)}%`
        : "No available data";

    overallProgress.style.width = overallPercentage !== null
        ? `${Math.min(overallPercentage, 100)}%`
        : "0%";

    seatSummary.textContent = seatTotal > 0
        ? `${occupiedTotal} of ${seatTotal} seats occupied`
        : "No occupancy data available at this time.";

    busiestArea.textContent = busiest ? busiest.name : "—";

    busiestFloor.textContent = busiest
        ? `${busiest.floor} · ${busiest.occupied ?? "—"} of ${busiest.total ?? "—"} seats`
        : "No data available";

    busiestRate.textContent = busiest
        ? `${busiest.rate.toFixed(1)}% occupied`
        : "";

    freestArea.textContent = freest ? freest.name : "—";

    freestFloor.textContent = freest
        ? `${freest.floor} · ${freest.occupied ?? "—"} of ${freest.total ?? "—"} seats`
        : "No data available";

    freestRate.textContent = freest
        ? `${freest.rate.toFixed(1)}% occupied`
        : "";
}

function renderAreaDetails(floor, area) {
    const details = document.getElementById("area-details");

    if (!area) {
        details.innerHTML = "<p>No study-area data available.</p>";
        return;
    }

    const rate = area.percentage;

    const hasSeatData =
        area.total !== null &&
        area.occupied !== null &&
        area.total > 0 &&
        area.occupied >= 0 &&
        area.occupied <= area.total;

    const available = hasSeatData
        ? area.total - area.occupied
        : null;

    let status = "No available data";
    let color = "gray";

    if (rate !== null) {
        status = "Available";
        color = "green";

        if (rate >= 80) {
            status = "Almost full";
            color = "red";
        } else if (rate >= 50) {
            status = "Getting busy";
            color = "gold";
        }
    }

    details.innerHTML = `
        <div class="area-card">
            <p class="area-floor">${floor.name}</p>
            <h3>${area.name}</h3>

            <div class="occupancy-heading">
                <span>Seat occupancy</span>
                <strong>${rate !== null ? `${rate.toFixed(1)}%` : "No available data"}</strong>
            </div>

            <div class="progress">
                <div class="progress-fill ${color}"
                     style="width: ${rate !== null ? rate : 0}%"></div>
            </div>

            <div class="area-stats">
                <div class="mini-stat">
                    <span>Total seats</span>
                    <strong>${hasSeatData ? area.total : "—"}</strong>
                </div>
                <div class="mini-stat">
                    <span>Occupied</span>
                    <strong>${hasSeatData ? area.occupied : "—"}</strong>
                </div>
                <div class="mini-stat">
                    <span>Available</span>
                    <strong>${hasSeatData ? available : "—"}</strong>
                </div>
            </div>

            <span class="occupancy-status ${color}">${status}</span>
            <p class="closed-description">
                Last recorded at ${formatTime(area.time)}.
            </p>
        </div>
    `;
}

function updateTimestamp() {
    const timestamp = document.getElementById("data-timestamp");

    if (!timestamp || !currentSnapshot) return;

    if (currentSnapshot.isWeekend) {
        timestamp.textContent =
            `Current time: ${currentSnapshot.currentTime} PHT | No observations today`;
    } else if (!currentSnapshot.targetTime) {
        timestamp.textContent =
            `Current time: ${currentSnapshot.currentTime} PHT | Observations begin at 7:30 AM`;
    } else {
        timestamp.textContent =
            `Current time: ${currentSnapshot.currentTime} PHT | Latest data: ${formatTime(currentSnapshot.targetTime)}`;
    }
}

function render() {
    const floorTabs = document.getElementById("floor-tabs");
    const areaTabs = document.getElementById("area-tabs");
    const floorTitle = document.getElementById("selected-floor-title");
    const areaCount = document.getElementById("area-count");

    updateTimestamp();

    floorTabs.innerHTML = "";
    areaTabs.innerHTML = "";

    if (floors.length === 0) {
        floorTitle.textContent = "No data";
        areaCount.textContent = "0 study areas";

        document.getElementById("area-details").innerHTML = `
            <p>No occupancy records are available for the current observation period.</p>
        `;

        updateSummary();
        return;
    }

    selectedFloor = Math.max(
        0,
        Math.min(selectedFloor, floors.length - 1)
    );

    floors.forEach((floor, index) => {
        const button = document.createElement("button");

        button.className = index === selectedFloor ? "tab active" : "tab";
        button.textContent = floor.name;

        button.onclick = () => {
            selectedFloor = index;
            render();
        };

        floorTabs.appendChild(button);
    });

    const floor = floors[selectedFloor];

    floorTitle.textContent = floor.name;
    areaCount.textContent =
        `${floor.areas.length} study area${floor.areas.length === 1 ? "" : "s"}`;

    floor.areas.forEach((area, index) => {
        const button = document.createElement("button");

        button.className = index === 0 ? "area-tab active" : "area-tab";
        button.textContent = area.name;

        button.onclick = () => {
            document.querySelectorAll(".area-tab").forEach(tab => {
                tab.classList.remove("active");
            });

            button.classList.add("active");
            renderAreaDetails(floor, area);
        };

        areaTabs.appendChild(button);
    });

    renderAreaDetails(floor, floor.areas[0]);
    updateSummary();
}

async function loadLiveRARY() {
    const details = document.getElementById("area-details");

    currentSnapshot = getPhilippineTime();

    if (!currentSnapshot.targetTime) {
        floors = [];
        selectedFloor = 0;
        render();
        return;
    }

    details.innerHTML = "<p>Loading occupancy data.</p>";

    try {
        const records = await fetchOccupancyData();

        floors = buildFloors(
            records,
            currentSnapshot.weekday,
            currentSnapshot.targetTime
        );

        selectedFloor = 0;
        render();

    } catch (error) {
        console.error("LiveRARY loading error:", error);

        details.innerHTML = `
            <p>Unable to load occupancy data.</p>
            <p>${error.message}</p>
        `;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadLiveRARY();

    // Update the actual Philippine clock every second.
    setInterval(() => {
        currentSnapshot = getPhilippineTime();
        updateTimestamp();
    }, 1000);

    // Refresh spreadsheet occupancy data every minute.
    setInterval(loadLiveRARY, 60000);
});
