-- ==========================================================
-- Smart Traffic Management System - MySQL Database Schema
-- Database: traffic_db
-- ==========================================================

CREATE DATABASE IF NOT EXISTS `traffic_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `traffic_db`;

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Users Table
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
    `email` VARCHAR(100) NOT NULL PRIMARY KEY,
    `password` VARCHAR(255) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `role` VARCHAR(50) NOT NULL DEFAULT 'owner',
    `national_id` VARCHAR(50) DEFAULT NULL,
    `user_id` VARCHAR(50) DEFAULT NULL,
    `phone` VARCHAR(50) DEFAULT NULL,
    `device_serial` VARCHAR(50) DEFAULT NULL,
    `contact_name` VARCHAR(100) DEFAULT NULL,
    `contact_phone` VARCHAR(50) DEFAULT NULL,
    `contact_email` VARCHAR(100) DEFAULT NULL,
    `threshold` DOUBLE DEFAULT 3.0,
    `disabled` TINYINT(1) DEFAULT 0,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Vehicles Table
DROP TABLE IF EXISTS `vehicles`;
CREATE TABLE `vehicles` (
    `vehicle_id` VARCHAR(50) NOT NULL PRIMARY KEY,
    `obu_serial` VARCHAR(50) DEFAULT NULL,
    `owner_user_id` VARCHAR(100) DEFAULT NULL,
    `last_status` VARCHAR(50) DEFAULT 'ACTIVE',
    `last_seen` VARCHAR(50) DEFAULT NULL,
    `last_latitude` DOUBLE DEFAULT NULL,
    `last_longitude` DOUBLE DEFAULT NULL,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Vehicle Mappings
DROP TABLE IF EXISTS `vehicle_mappings`;
CREATE TABLE `vehicle_mappings` (
    `cloud_vehicle_id` VARCHAR(50) NOT NULL PRIMARY KEY,
    `local_vehicle_id` VARCHAR(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Accidents Table
DROP TABLE IF EXISTS `accidents`;
CREATE TABLE `accidents` (
    `event_id` VARCHAR(100) NOT NULL PRIMARY KEY,
    `vehicle_id` VARCHAR(50) DEFAULT NULL,
    `obu_serial` VARCHAR(50) DEFAULT NULL,
    `severity` VARCHAR(50) DEFAULT 'MODERATE',
    `confidence_score` DOUBLE DEFAULT 85.0,
    `confidence_level` VARCHAR(50) DEFAULT 'HIGH',
    `peak_accel_mag_g` DOUBLE DEFAULT 4.5,
    `avg_accel_mag_g` DOUBLE DEFAULT 2.1,
    `peak_jerk` DOUBLE DEFAULT 35.0,
    `peak_gyro_mag` DOUBLE DEFAULT 120.0,
    `latitude` DOUBLE DEFAULT NULL,
    `longitude` DOUBLE DEFAULT NULL,
    `created_at` VARCHAR(50) DEFAULT NULL,
    `event_timestamp` VARCHAR(50) DEFAULT NULL,
    `packets_analysed` INT DEFAULT 10
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. Analytics Table (Road risk analysis)
DROP TABLE IF EXISTS `analytics`;
CREATE TABLE `analytics` (
    `metric_id` VARCHAR(100) NOT NULL PRIMARY KEY,
    `accident_count` INT DEFAULT 0,
    `critical_count` INT DEFAULT 0,
    `severe_count` INT DEFAULT 0,
    `moderate_count` INT DEFAULT 0,
    `minor_count` INT DEFAULT 0,
    `street_name` VARCHAR(150) DEFAULT '',
    `danger_score` DOUBLE DEFAULT 0.0,
    `risk_level` VARCHAR(50) DEFAULT 'LOW',
    `latitude` DOUBLE DEFAULT NULL,
    `longitude` DOUBLE DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. Dispatch Cases Table
DROP TABLE IF EXISTS `dispatch_cases`;
CREATE TABLE `dispatch_cases` (
    `case_id` VARCHAR(100) NOT NULL PRIMARY KEY,
    `event_id` VARCHAR(100) DEFAULT NULL,
    `vehicle_id` VARCHAR(50) DEFAULT NULL,
    `obu_serial` VARCHAR(50) DEFAULT NULL,
    `severity` VARCHAR(50) DEFAULT NULL,
    `dispatch_status` VARCHAR(50) DEFAULT 'PENDING',
    `created_at` VARCHAR(50) DEFAULT NULL,
    `ambulance_status` VARCHAR(50) DEFAULT 'STANDBY',
    `police_status` VARCHAR(50) DEFAULT 'STANDBY'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. Emergency Units Table
DROP TABLE IF EXISTS `emergency_units`;
CREATE TABLE `emergency_units` (
    `id` VARCHAR(50) NOT NULL PRIMARY KEY,
    `type` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `status` VARCHAR(50) NOT NULL,
    `lat` DOUBLE DEFAULT NULL,
    `lng` DOUBLE DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. Audit Logs Table
DROP TABLE IF EXISTS `audit_logs`;
CREATE TABLE `audit_logs` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `actor` VARCHAR(100) NOT NULL,
    `action` TEXT NOT NULL,
    `timestamp` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ==========================================================
-- SEED DATA (Default Accounts, Vehicles, Accidents, Analytics)
-- ==========================================================

-- Default Users (Passwords hashed with SHA-256):
-- admin123      -> 240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9
-- dispatcher123 -> a445e99859f518e93ec7a6f236f0e4b85ce4fbf6cf83d2c77d4a23a1a3e6bb69
-- owner123      -> 43a0d17178a9d26c9e0fe9a74b0b45e38d32f27aed887a008a54bf6e033bf7b9
INSERT INTO `users` (`email`, `password`, `name`, `role`, `national_id`, `user_id`, `phone`, `device_serial`, `contact_name`, `contact_phone`, `contact_email`, `threshold`, `disabled`) VALUES
('admin@traffic.gov', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'Dr. Safaa Shaarawi', 'admin', NULL, 'USER1', '01012345678', NULL, NULL, NULL, NULL, 3.0, 0),
('dispatcher@traffic.gov', 'a445e99859f518e93ec7a6f236f0e4b85ce4fbf6cf83d2c77d4a23a1a3e6bb69', 'Officer Karim Ahmed', 'admin', NULL, 'USER2', '01012345679', NULL, NULL, NULL, NULL, 3.0, 0),
('owner@gmail.com', '43a0d17178a9d26c9e0fe9a74b0b45e38d32f27aed887a008a54bf6e033bf7b9', 'Zyead Hashem', 'owner', '29801010101234', 'USER3', '01012345680', 'OBU-000001', 'Safaa Ali Ibrahim (Spouse)', '+20 1023456789', 'safaa.ali@gmail.com', 3.0, 0);

-- Vehicles Seed
INSERT INTO `vehicles` (`vehicle_id`, `obu_serial`, `owner_user_id`, `last_status`, `last_seen`, `last_latitude`, `last_longitude`) VALUES
('CAR-EG-101', 'OBU-000001', 'owner@gmail.com', 'ACTIVE', '2026-10-11T18:30:00Z', 30.0444, 31.2357),
('CAR-EG-102', 'OBU-000002', 'admin@traffic.gov', 'ACTIVE', '2026-10-11T18:25:00Z', 30.0131, 31.2089),
('CAR-EG-103', 'OBU-000003', 'USER2', 'CRITICAL', '2026-10-11T18:20:00Z', 30.0610, 31.3320),
('CAR-EG-104', 'OBU-000004', 'USER4', 'ACTIVE', '2026-10-11T18:15:00Z', 30.0765, 31.1550),
('CAR-EG-105', 'OBU-000005', 'USER5', 'ACTIVE', '2026-10-11T18:10:00Z', 29.9821, 31.2854);

-- Accidents Seed
INSERT INTO `accidents` (`event_id`, `vehicle_id`, `obu_serial`, `severity`, `confidence_score`, `confidence_level`, `peak_accel_mag_g`, `avg_accel_mag_g`, `peak_jerk`, `peak_gyro_mag`, `latitude`, `longitude`, `created_at`, `event_timestamp`, `packets_analysed`) VALUES
('EVT-1001', 'CAR-EG-103', 'OBU-000003', 'CRITICAL', 94.5, 'HIGH', 7.2, 3.8, 52.0, 185.0, 30.0610, 31.3320, '2026-10-11 18:20:00', '2026-10-11T18:20:00Z', 15),
('EVT-1002', 'CAR-EG-101', 'OBU-000001', 'MODERATE', 82.0, 'HIGH', 3.8, 1.9, 28.5, 95.0, 30.0444, 31.2357, '2026-10-11 14:10:00', '2026-10-11T14:10:00Z', 10),
('EVT-1003', 'CAR-EG-105', 'OBU-000005', 'SEVERE', 89.0, 'HIGH', 5.5, 2.7, 41.2, 140.0, 29.9821, 31.2854, '2026-10-11 11:45:00', '2026-10-11T11:45:00Z', 12);

-- Dispatch Cases Seed
INSERT INTO `dispatch_cases` (`case_id`, `event_id`, `vehicle_id`, `obu_serial`, `severity`, `dispatch_status`, `created_at`, `ambulance_status`, `police_status`) VALUES
('DISP-001', 'EVT-1001', 'CAR-EG-103', 'OBU-000003', 'CRITICAL', 'PENDING', '2026-10-11 18:21:00', 'STANDBY', 'STANDBY'),
('DISP-002', 'EVT-1003', 'CAR-EG-105', 'OBU-000005', 'SEVERE', 'COMPLETED', '2026-10-11 11:46:00', 'DISPATCHED', 'DISPATCHED');

-- Analytics Seed (Blackspots and risk corridors)
INSERT INTO `analytics` (`metric_id`, `accident_count`, `critical_count`, `severe_count`, `moderate_count`, `minor_count`, `street_name`, `danger_score`, `risk_level`, `latitude`, `longitude`) VALUES
('ROAD_30.06_31.33', 14, 6, 5, 2, 1, 'Heliopolis Ring Road Corridor', 88.5, 'HIGH', 30.0610, 31.3320),
('ROAD_30.07_31.15', 8, 2, 3, 2, 1, '26th of July Corridor', 65.0, 'MEDIUM', 30.0765, 31.1550),
('ROAD_29.98_31.28', 11, 4, 4, 2, 1, 'Maadi Ring Road', 76.2, 'HIGH', 29.9821, 31.2854),
('ROAD_30.04_31.23', 5, 1, 1, 2, 1, 'El-Tahrir Square & Downtown', 42.0, 'LOW', 30.0444, 31.2357);

-- Emergency Units Seed
INSERT INTO `emergency_units` (`id`, `type`, `name`, `status`, `lat`, `lng`) VALUES
('AMB-01', 'Ambulance', 'Cairo Central Ambulance #01', 'AVAILABLE', 30.0500, 31.2400),
('AMB-02', 'Ambulance', 'Nasr City Response Unit #02', 'ON_DUTY', 30.0600, 31.3200),
('POL-01', 'Police', 'Traffic Patrol Unit North-4', 'AVAILABLE', 30.0800, 31.1600),
('POL-02', 'Police', 'Maadi Highway Patrol Unit-7', 'AVAILABLE', 29.9900, 31.2800);

SET FOREIGN_KEY_CHECKS = 1;
