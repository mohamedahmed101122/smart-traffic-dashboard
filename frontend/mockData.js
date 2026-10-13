// Cairo, Egypt geographical center coordinates: 30.0444, 31.2357
const CAIRO_HOTSPOTS = [
    { name: "6th of October Bridge, Downtown", lat: 30.0524, lng: 31.2462 },
    { name: "Ring Road, Near Maadi Exit", lat: 29.9821, lng: 31.2854 },
    { name: "26th of July Corridor (Mehwar), Giza", lat: 30.0765, lng: 31.1550 },
    { name: "90th Street, New Cairo", lat: 30.0242, lng: 31.4658 },
    { name: "El-Nasr Road, Heliopolis", lat: 30.0894, lng: 31.3321 },
    { name: "Cairo-Alexandria Desert Road, Smart Village Exit", lat: 30.0782, lng: 31.0210 },
    { name: "Autostrad Road, El-Basatin", lat: 29.9712, lng: 31.2785 }
];

const initialAccidents = [
    {
        id: "ACC-4092",
        severity: "critical",
        lat: 30.0524,
        lng: 31.2462,
        locationName: "6th of October Bridge, Downtown",
        timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(), // 15 mins ago
        speed: 95,
        status: "pending",
        assignedUnit: "None",
        imu: {
            accelX: 3.8,
            accelY: -1.2,
            accelZ: -0.4,
            roll: 45,
            pitch: -22,
            yaw: 105,
            temp: 42
        }
    },
    {
        id: "ACC-3891",
        severity: "major",
        lat: 29.9821,
        lng: 31.2854,
        locationName: "Ring Road, Near Maadi Exit",
        timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(), // 45 mins ago
        speed: 78,
        status: "responded",
        assignedUnit: "Ambulance A1",
        imu: {
            accelX: -2.1,
            accelY: 2.5,
            accelZ: 0.8,
            roll: 12,
            pitch: 35,
            yaw: -45,
            temp: 36
        }
    },
    {
        id: "ACC-1204",
        severity: "minor",
        lat: 30.0242,
        lng: 31.4658,
        locationName: "90th Street, New Cairo",
        timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(), // 2 hours ago
        speed: 45,
        status: "closed",
        assignedUnit: "Police P1",
        imu: {
            accelX: 1.2,
            accelY: -0.8,
            accelZ: 0.9,
            roll: 3,
            pitch: 5,
            yaw: 180,
            temp: 34
        }
    }
];

const mockEmergencyUnits = [
    { id: "Ambulance A1", type: "ambulance", name: "Ambulance A1 (Maadi)", status: "busy", lat: 29.9781, lng: 31.2890 },
    { id: "Ambulance A2", type: "ambulance", name: "Ambulance A2 (Tahrir)", status: "available", lat: 30.0444, lng: 31.2357 },
    { id: "Ambulance A3", type: "ambulance", name: "Ambulance A3 (New Cairo)", status: "available", lat: 30.0150, lng: 31.4550 },
    { id: "Ambulance A4", type: "ambulance", name: "Ambulance A4 (Giza)", status: "available", lat: 30.0130, lng: 31.2082 },
    { id: "Police P1", type: "police", name: "Traffic Patrol P1 (Heliopolis)", status: "busy", lat: 30.0950, lng: 31.3200 },
    { id: "Police P2", type: "police", name: "Traffic Patrol P2 (October)", status: "available", lat: 30.0650, lng: 30.9850 },
    { id: "Police P3", type: "police", name: "Traffic Patrol P3 (Ring Road)", status: "available", lat: 29.9980, lng: 31.3120 }
];

// Helper function to generate simulated accident data
function generateSimulatedAccident(severity) {
    const hotspot = CAIRO_HOTSPOTS[Math.floor(Math.random() * CAIRO_HOTSPOTS.length)];
    // Add small random offset to hotspot coordinates to simulate unique positions
    const latOffset = (Math.random() - 0.5) * 0.015;
    const lngOffset = (Math.random() - 0.5) * 0.015;
    const finalLat = hotspot.lat + latOffset;
    const finalLng = hotspot.lng + lngOffset;

    const id = "ACC-" + Math.floor(1000 + Math.random() * 9000);
    const timestamp = new Date().toISOString();

    let speed, accelX, accelY, roll, pitch, temp;

    if (severity === "critical") {
        speed = Math.floor(90 + Math.random() * 50); // High speed 90-140 km/h
        accelX = parseFloat((3.5 + Math.random() * 3).toFixed(1)); // High impact 3.5 - 6.5g
        accelY = parseFloat(((Math.random() - 0.5) * 4).toFixed(1));
        roll = Math.floor(30 + Math.random() * 150); // Rollover risk
        pitch = Math.floor((Math.random() - 0.5) * 90);
        temp = Math.floor(40 + Math.random() * 35); // Engine fire risk 40-75C
    } else if (severity === "major") {
        speed = Math.floor(60 + Math.random() * 40); // Moderate speed 60-100 km/h
        accelX = parseFloat((2.0 + Math.random() * 1.5).toFixed(1)); // 2.0 - 3.5g
        accelY = parseFloat(((Math.random() - 0.5) * 3).toFixed(1));
        roll = Math.floor((Math.random() - 0.5) * 40);
        pitch = Math.floor((Math.random() - 0.5) * 40);
        temp = Math.floor(35 + Math.random() * 10);
    } else { // minor
        speed = Math.floor(20 + Math.random() * 35); // Low speed 20-55 km/h
        accelX = parseFloat((1.2 + Math.random() * 0.8).toFixed(1)); // 1.2 - 2.0g
        accelY = parseFloat(((Math.random() - 0.5) * 1.5).toFixed(1));
        roll = Math.floor((Math.random() - 0.5) * 15);
        pitch = Math.floor((Math.random() - 0.5) * 15);
        temp = Math.floor(30 + Math.random() * 8);
    }

    return {
        id: id,
        severity: severity,
        lat: finalLat,
        lng: finalLng,
        locationName: hotspot.name,
        timestamp: timestamp,
        speed: speed,
        status: "pending",
        assignedUnit: "None",
        imu: {
            accelX: accelX,
            accelY: accelY,
            accelZ: parseFloat((0.8 + (Math.random() - 0.5) * 0.4).toFixed(1)),
            roll: roll,
            pitch: pitch,
            yaw: Math.floor(Math.random() * 360),
            temp: temp
        }
    };
}
