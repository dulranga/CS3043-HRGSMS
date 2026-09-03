---
title: "SkyNest Hotel Reservation and Guest Services Management System"
subtitle: "Software Requirements Specification"
version: "1.0"
date: "24 July 2026"
---

**SkyNest Hotel Reservation and Guest Services Management System**

**Version 1.0 approved**

**Prepared by: Project Team**

\[Insert team member names and registration numbers\]

Database Systems Project

24 July 2026

> **Diagram assets:** Keep the `SkyNest_HRGSMS_SRS_assets` folder beside this Markdown file so that all figures render correctly.

# Table of Contents

- [1. Introduction](#1-introduction)
  - [1.1 Purpose](#11-purpose)
  - [1.2 Document Conventions](#12-document-conventions)
  - [1.3 Intended Audience and Reading Suggestions](#13-intended-audience-and-reading-suggestions)
  - [1.4 Product Scope](#14-product-scope)
  - [1.5 References](#15-references)
- [2. Overall Description](#2-overall-description)
  - [2.1 Product Perspective](#21-product-perspective)
  - [2.2 Product Functions](#22-product-functions)
  - [2.3 User Classes and Characteristics](#23-user-classes-and-characteristics)
  - [2.4 Operating Environment](#24-operating-environment)
  - [2.5 Design and Implementation Constraints](#25-design-and-implementation-constraints)
  - [2.6 User Documentation](#26-user-documentation)
  - [2.7 Assumptions and Dependencies](#27-assumptions-and-dependencies)
- [3. External Interface Requirements](#3-external-interface-requirements)
  - [3.1 User Interfaces](#31-user-interfaces)
  - [3.2 Hardware Interfaces](#32-hardware-interfaces)
  - [3.3 Software Interfaces](#33-software-interfaces)
  - [3.4 Communications Interfaces](#34-communications-interfaces)
- [4. System Features](#4-system-features)
  - [4.1 Authentication and Role-Based Access Control](#41-authentication-and-role-based-access-control)
  - [4.2 Branch, Room Type, Amenity and Room Management](#42-branch-room-type-amenity-and-room-management)
  - [4.3 Guest Profile Management](#43-guest-profile-management)
  - [4.4 Room Availability and Reservation Management](#44-room-availability-and-reservation-management)
  - [4.5 Guest Check-In and Active Stay Management](#45-guest-check-in-and-active-stay-management)
  - [4.6 Chargeable Guest Service Management](#46-chargeable-guest-service-management)
  - [4.7 Billing, Invoicing and Payment Management](#47-billing-invoicing-and-payment-management)
  - [4.8 Checkout, Cancellation and No-Show Management](#48-checkout-cancellation-and-no-show-management)
  - [4.9 Management Reports and Operational Dashboards](#49-management-reports-and-operational-dashboards)
  - [4.10 Administration, Configuration and Audit](#410-administration-configuration-and-audit)
- [5. Other Nonfunctional Requirements](#5-other-nonfunctional-requirements)
  - [5.1 Performance Requirements](#51-performance-requirements)
  - [5.2 Safety Requirements](#52-safety-requirements)
  - [5.3 Security Requirements](#53-security-requirements)
  - [5.4 Software Quality Attributes](#54-software-quality-attributes)
  - [5.5 Business Rules](#55-business-rules)
- [6. Other Requirements](#6-other-requirements)
  - [6.1 Database Requirements and Design](#61-database-requirements-and-design)
  - [6.2 Deployment Architecture](#62-deployment-architecture)
  - [6.3 CI/CD Pipeline](#63-cicd-pipeline)
  - [6.4 Test Requirements](#64-test-requirements)
  - [6.5 Acceptance Criteria](#65-acceptance-criteria)
  - [6.6 Migration and Initialization](#66-migration-and-initialization)
  - [6.7 Localization, Legal and Policy Considerations](#67-localization-legal-and-policy-considerations)
- [Appendix A: Glossary](#appendix-a-glossary)
- [Appendix B: Analysis Models](#appendix-b-analysis-models)
- [Appendix C: To Be Determined List](#appendix-c-to-be-determined-list)

# List of Figures

| Figure 1 - System Environment and External Actors | Figure 12 - Reporting Data Flow                                            |
|---------------------------------------------------|----------------------------------------------------------------------------|
| Figure 2 - High-Level Component Architecture      | Figure 13 - Database Object and Responsibility Map                         |
| Figure 3 - User Roles and Major Use Cases         | Figure 14 - Core Reservation Entity-Relationship Model                     |
| Figure 4 - Level-0 Data Flow Diagram              | Figure 15 - Service, Billing, Security and Audit Entity-Relationship Model |
| Figure 5 - Room Operational State Model           | Figure 16 - Booking Transaction and Concurrency Control                    |
| Figure 6 - Reservation Creation Workflow          | Figure 17 - Reporting View and Export Flow                                 |
| Figure 7 - Booking Status State Model             | Figure 18 - Backup and Recovery Model                                      |
| Figure 8 - Guest Check-In Workflow                | Figure 19 - Target Deployment Architecture                                 |
| Figure 9 - Service Usage Recording Workflow       | Figure 20 - Continuous Integration and Deployment Pipeline                 |
| Figure 10 - Billing Calculation Model             | Figure 21 - Requirements-to-Release Traceability Flow                      |
| Figure 11 - Checkout and Final Billing Workflow   |                                                                            |

# List of Tables

| Table 1 - Revision History                                       | Table 30 - Performance Requirements                 |
|------------------------------------------------------------------|-----------------------------------------------------|
| Table 2 - Intended Audience and Reading Suggestions              | Table 31 - Safety Requirements                      |
| Table 3 - User Classes and Characteristics                       | Table 32 - Security Requirements                    |
| Table 4 - Design and Implementation Constraints                  | Table 33 - Reliability Requirements                 |
| Table 5 - Assumptions and Dependencies                           | Table 34 - Usability Requirements                   |
| Table 6 - User Interface Screens                                 | Table 35 - Maintainability Requirements             |
| Table 7 - User Interface Requirements                            | Table 36 - Portability Requirements                 |
| Table 8 - Software Interfaces                                    | Table 37 - Logging Requirements                     |
| Table 9 - Communications Interface Requirements                  | Table 38 - Business Rules                           |
| Table 10 - Use Case - Authenticate Staff User                    | Table 39 - Entity Summary                           |
| Table 11 - Authentication and Access Requirements                | Table 40 - Core Data Dictionary                     |
| Table 12 - Use Case - Maintain Room Inventory                    | Table 41 - Database Integrity Requirements          |
| Table 13 - Room Inventory Requirements                           | Table 42 - Normalization Progress                   |
| Table 14 - Use Case - Create or Update Guest Profile             | Table 43 - ACID Application                         |
| Table 15 - Guest Management Requirements                         | Table 44 - Transaction and Concurrency Requirements |
| Table 16 - Use Case - Search Availability and Create Booking     | Table 45 - Required SQL Objects                     |
| Table 17 - Availability and Reservation Requirements             | Table 46 - Index Requirements                       |
| Table 18 - Use Case - Check In Guest                             | Table 47 - Required Views                           |
| Table 19 - Check-In Requirements                                 | Table 48 - Seed Data Baseline                       |
| Table 20 - Use Case - Record Service Usage                       | Table 49 - Backup and Recovery Requirements         |
| Table 21 - Guest Service Requirements                            | Table 50 - Deployment Requirements                  |
| Table 22 - Use Case - Generate Bill and Record Payment           | Table 51 - CI/CD Requirements                       |
| Table 23 - Billing and Payment Requirements                      | Table 52 - Required Test Levels                     |
| Table 24 - Use Case - Check Out Guest                            | Table 53 - Requirements Traceability Matrix         |
| Table 25 - Checkout and Cancellation Requirements                | Table 54 - Key Acceptance Tests                     |
| Table 26 - Use Case - Generate Management Report                 | Table 55 - Glossary                                 |
| Table 27 - Reporting Requirements                                | Table 56 - Analysis Model Index                     |
| Table 28 - Use Case - Manage User Account and Review Audit Trail | Table 57 - To Be Determined Items                   |
| Table 29 - Administration and Audit Requirements                 |                                                     |

# Revision History

**Table 1 - Revision History**

| **Name**                      | **Date**        | **Reason for Changes**                                                                            | **Version** |
|-------------------------------|-----------------|---------------------------------------------------------------------------------------------------|-------------|
| Project Team                  | 24 July 2026    | Complete SRS created from the supplied project brief, IEEE-style SRS template and example design. | 1.0         |
| Project Supervisor / Lecturer | To be completed | Review, corrections and formal approval.                                                          | 1.1         |

# 1. Introduction

## 1.1 Purpose

The purpose of this document is to present a complete and verifiable description of the SkyNest Hotel Reservation and Guest Services Management System (HRGSMS), Version 1.0. It describes the purpose and features of the system, its interfaces, the constraints under which it shall operate, the relational data model, and the responses expected when users or external conditions stimulate the system.

This SRS covers the complete university database project: requirements analysis, a normalized SQL database, a full-stack Next.js application, parameterized raw SQL data access, procedures, functions, triggers, reporting, testing, deployment and CI/CD. It is intended for stakeholders, developers, database designers, testers and evaluators and shall be the baseline for design, implementation and acceptance.

## 1.2 Document Conventions

Mandatory requirements use the word “shall.” Recommendations use “should,” and optional capabilities use “may.” Functional requirements are identified as FR-xxx, database requirements as DBR-xxx, interface requirements as IR-xxx, nonfunctional requirements as NFR-xxx, business rules as BR-xxx and deployment requirements as DR-xxx. Critical and High priorities are required for the minimum acceptable release unless formally waived.

The document follows the section order of the supplied IEEE-style SRS template and uses the use-case and diagram presentation style of the supplied example. The main narrative uses 14-point Times New Roman with a plain black-and-white layout. Light grey fills are used only for table headings and diagram boxes. Tables and figure captions use compact text where required to preserve readability and remain within the requested page limit.

## 1.3 Intended Audience and Reading Suggestions

**Table 2 - Intended Audience and Reading Suggestions**

| **Audience**                      | **Recommended Reading Sequence**                                                                                                                                     |
|-----------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Lecturer / project evaluator      | Sections 1 and 2 for context; Section 4 for functional scope; Sections 5 and 6 for quality, database and deployment evidence; Appendices for terminology and models. |
| Hotel management stakeholder      | Sections 1, 2, 4.4 to 4.9 and 5.5 business rules.                                                                                                                    |
| Database designer / SQL developer | Sections 4, 5.5 and 6.1, especially schema, normalization, transactions, SQL objects, indexing and reporting views.                                                  |
| Next.js developer                 | Sections 2.4 to 2.5, Section 3, Section 4, and Sections 6.2 to 6.3.                                                                                                  |
| Tester / quality reviewer         | Use cases and requirements in Section 4, measurable requirements in Section 5, and test/acceptance requirements in Sections 6.4 and 6.5.                             |
| Deployment / operations member    | Sections 2.4, 2.5, 5.3, and Sections 6.2 to 6.7.                                                                                                                     |

Readers seeking an overview should begin with Sections 1 and 2. Implementers should then read the relevant interfaces and system features before the database and deployment requirements. Testers should trace each uniquely identified requirement to the verification method stated in its table.

## 1.4 Product Scope

SkyNest Hotels is a regional hotel chain with branches in Colombo, Kandy and Galle. The current desktop-based and manual processes have contributed to overbooking, delayed billing and data-entry errors. HRGSMS will replace those processes with a unified web application whose authoritative data is stored in a normalized relational database.

The system shall support branch and room management, guest profiles, availability searches, reservations, check-in, active-stay service usage, partial payments, invoice generation, checkout and management reports. It shall prevent overlapping active bookings for the same room, maintain consistent room and booking states, preserve historical rates and prices, and prevent checkout until the final balance is paid.

The implementation shall use Next.js for the frontend and backend and PostgreSQL as the reference database. The application shall execute reviewed, parameterized SQL through a PostgreSQL driver. ORM frameworks, Supabase, Firebase and equivalent backend-as-a-service database abstractions are prohibited. The system shall be fully implemented, tested and deployed using a CI/CD pipeline.

- Reduce overbooking by enforcing room/date conflicts at database level.

- Reduce billing delay and error through reproducible room and service calculations.

- Use normalization, keys, constraints and referential integrity to reduce anomalies.

- Support partial payments while clearly identifying outstanding balances.

- Provide the five mandatory management reports from controlled SQL views or queries.

- Deliver a repeatable deployment through migrations, automated tests and CI/CD.

## 1.5 References

1.  Project 5 - Hotel Reservation and Guest Services Management System, supplied project description, two pages.

2.  Software Requirements Specification for \<Project\>, supplied IEEE-style template based on Karl E. Wiegers.

3.  Web Publishing System Software Requirements Specification, Version 1.0, supplied example SRS.

4.  The approved project repository, SQL migrations, test plan, deployment records and user guide produced by the project team.

# 2. Overall Description

## 2.1 Product Perspective

HRGSMS is a new centralized web system that replaces separate desktop and manual processes used by the three SkyNest branches. It is self-contained for the academic release and shall not depend on an external booking engine, payment gateway, ORM, Supabase, Firebase or cloud document database. It will expose controlled user interfaces while retaining all authoritative operational and financial state in PostgreSQL.

<img src="SkyNest_HRGSMS_SRS_assets/image1.png" style="width:5.55in;height:2.12481in" />

**Figure 1 - System Environment and External Actors**

<img src="SkyNest_HRGSMS_SRS_assets/image2.png" style="width:5.55in;height:6.38684in" />

**Figure 2 - High-Level Component Architecture**

The system environment contains browser users, the full-stack Next.js application, a raw-SQL access layer, PostgreSQL database objects, source control and CI/CD, and logging/audit facilities. Multi-table state changes shall be performed inside transactions or controlled SQL routines so the user interface cannot leave the database partially updated.

## 2.2 Product Functions

<img src="SkyNest_HRGSMS_SRS_assets/image3.png" style="width:5.55in;height:8.10359in" />

**Figure 3 - User Roles and Major Use Cases**

- Authenticate staff and enforce role- and branch-based permissions.

- Maintain branches, room types, amenities, room records, statuses, blocks and rates.

- Create and update guest profiles while avoiding unnecessary duplication.

- Search availability and create, modify or cancel reservations.

- Check guests in and update room occupancy atomically.

- Record room service, spa, laundry, minibar and other chargeable services.

- Generate invoices, accept partial payments and display outstanding balances.

- Prevent checkout until all required charges are paid.

- Release rooms after checkout and support cleaning and maintenance states.

- Generate occupancy, billing, service usage, monthly revenue and preference reports.

- Record auditable booking, room, payment and administrative histories.

## 2.3 User Classes and Characteristics

**Table 3 - User Classes and Characteristics**

| **User Class**                    | **Characteristics and Main Privileges**                                                                                                                              |
|-----------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Guest                             | Provides identity/contact and stay information, receives confirmations, invoices and receipts. Direct self-service is optional; staff-assisted booking is mandatory. |
| Front Desk Staff                  | Frequent operational user. Searches availability, manages guests and bookings, checks guests in, records payments and completes checkout within an assigned branch.  |
| Service Staff                     | Records approved service usage for checked-in bookings. Cannot alter booking dates, room rates, invoices or payments.                                                |
| Branch Manager                    | Maintains rooms, rates, blocks and branch configuration, approves controlled discounts and views branch reports.                                                     |
| Chain Manager / Management Viewer | Views cross-branch reports, revenue and service trends. Normally read-only for operational records.                                                                  |
| System Administrator              | Manages accounts, roles and reference configuration. Cannot bypass database integrity or financial constraints.                                                      |
| Database Administrator / Auditor  | Maintains database availability, migration, backup and recovery and reviews audit evidence. Direct data changes are restricted and logged.                           |

## 2.4 Operating Environment

- Modern desktop or tablet web browser with JavaScript enabled.

- Next.js application on a supported Node.js runtime hosted on Linux or a compatible platform.

- PostgreSQL relational database on a separate protected service or host.

- HTTPS between browser and application and an encrypted database connection where supported.

- Git-based source control and a CI/CD runner capable of starting a temporary PostgreSQL database.

- Currency displayed in Sri Lankan Rupees (LKR) and operational time interpreted in Asia/Colombo.

- A reachable staging and production deployment for final evaluation.

## 2.5 Design and Implementation Constraints

**Table 4 - Design and Implementation Constraints**

| **ID** | **Constraint**                                                                                                                                                         |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| CON-01 | PostgreSQL shall be the reference database. MySQL may be substituted only with equivalent documented constraints and transaction behavior approved by the evaluator.   |
| CON-02 | The frontend and backend shall be implemented with Next.js.                                                                                                            |
| CON-03 | The application shall use parameterized raw SQL. No ORM, Supabase, Firebase or equivalent database abstraction is permitted.                                           |
| CON-04 | The schema shall demonstrate normalization, primary keys, foreign keys, uniqueness, domain checks, indexing, views, procedures/functions and triggers where justified. |
| CON-05 | Concurrent requests shall not create overlapping active bookings for one room.                                                                                         |
| CON-06 | Financial values shall use exact decimal types; rates and prices shall be preserved as historical snapshots.                                                           |
| CON-07 | Schema changes shall be version-controlled SQL migrations and tested before deployment.                                                                                |
| CON-08 | Secrets and production database credentials shall not be stored in the repository or exposed to the browser.                                                           |
| CON-09 | The delivered system shall include minimum demonstration data required by the project brief.                                                                           |
| CON-10 | The complete system shall be deployed through a CI/CD pipeline.                                                                                                        |

## 2.6 User Documentation

- Role-oriented user guide for front-desk staff, service staff, managers and administrators.

- Quick reference for booking, check-in, service entry, payment and checkout.

- Database setup and migration guide with clean installation and seed instructions.

- Deployment and rollback guide for the CI/CD pipeline and hosting environment.

- Test-data loading guide and report-verification examples.

- API/route and SQL-object documentation maintained with the repository.

## 2.7 Assumptions and Dependencies

**Table 5 - Assumptions and Dependencies**

| **ID** | **Assumption / Dependency**                                                                                                           |
|--------|---------------------------------------------------------------------------------------------------------------------------------------|
| A/D-01 | SkyNest begins with three branches: Colombo, Kandy and Galle.                                                                         |
| A/D-02 | Each booking reserves one room for a date interval and has one primary guest; future multi-room/group booking is outside Version 1.0. |
| A/D-03 | Check-in date is inclusive and check-out date is exclusive for overlap and billing-night calculations.                                |
| A/D-04 | Taxes, service charges, discounts, cancellation fees and late-checkout amounts are configurable rather than hard-coded.               |
| A/D-05 | Payment information records method, amount, reference and status; direct card processing is outside the assessed scope.               |
| A/D-06 | Staff use reliable network connectivity and approved credentials.                                                                     |
| A/D-07 | The hosting platform supplies protected secrets, HTTPS and a supported PostgreSQL service.                                            |
| A/D-08 | Legacy desktop data format is unknown; automatic migration is not mandatory unless a source format is later provided.                 |
| A/D-09 | Guest self-service access may be added later; all mandatory functions remain available to authorized staff.                           |

Out of scope for Version 1.0 are a live payment gateway, smart-lock or point-of-sale integration, dynamic pricing from machine learning, loyalty points, housekeeping payroll, inventory procurement, multi-currency settlement and native mobile applications.

# 3. External Interface Requirements

## 3.1 User Interfaces

The interface shall use a consistent, responsive layout with a top-level navigation appropriate to the authenticated role. Forms shall display labels, required-field indicators, validation messages and safe confirmation dialogs. Lists shall support filtering, pagination and branch scoping. Error messages shall explain corrective action without exposing SQL statements, stack traces or secrets.

**Table 6 - User Interface Screens**

| **Screen**                    | **Primary User**        | **Purpose**                                                                                     |
|-------------------------------|-------------------------|-------------------------------------------------------------------------------------------------|
| Login                         | All staff               | Authenticate and establish a secure role/branch session.                                        |
| Dashboard                     | Role dependent          | Show arrivals, departures, occupied rooms, unpaid balances and operational notices.             |
| Availability Search           | Guest / Front Desk      | Enter branch, dates, capacity and optional room type; display currently sellable rooms.         |
| Booking Form                  | Front Desk              | Create or modify a reservation with guest, room, dates, agreed rate, payment method and status. |
| Guest Profile                 | Front Desk              | Search, create and update guest identity/contact information and review history.                |
| Check-In                      | Front Desk              | Verify booking, guest and room readiness and perform the controlled state change.               |
| Service Usage                 | Service Staff           | Record service, usage date/time, quantity and price snapshot for an active stay.                |
| Billing and Payments          | Front Desk              | Display invoice lines, payments, partial-payment status and outstanding balance.                |
| Checkout                      | Front Desk              | Finalize charges, verify zero balance, check out and print invoice/receipt.                     |
| Room and Rate Administration  | Manager                 | Maintain branches, room types, amenities, rooms, blocks, rates and statuses.                    |
| Reports                       | Manager / Auditor       | Run the five mandatory reports with branch/date filters and export.                             |
| User and Audit Administration | Administrator / Auditor | Manage staff accounts and review protected audit history.                                       |

**Table 7 - User Interface Requirements**

| **ID**   | **Requirement**                                                                                 | **Priority and Verification**           |
|----------|-------------------------------------------------------------------------------------------------|-----------------------------------------|
| IR-UI-01 | The UI shall hide operations not permitted to the authenticated role.                           | High; Inspection and authorization test |
| IR-UI-02 | Every form shall provide field-level validation without discarding valid data already entered.  | High; UI test                           |
| IR-UI-03 | Booking, invoice and payment confirmation screens shall display unique reference identifiers.   | High; Functional test                   |
| IR-UI-04 | Result tables shall paginate or incrementally load when their configured threshold is exceeded. | Medium; Performance and UI test         |
| IR-UI-05 | Primary workflows shall remain usable on common laptop and tablet widths.                       | Medium; Responsive inspection           |
| IR-UI-06 | Error messages shall not reveal SQL, credentials, internal paths or stack traces.               | High; Security test                     |

## 3.2 Hardware Interfaces

No specialized hotel hardware is required. The system shall operate with standard computers or tablets, keyboards, printers and network connections. Printable invoices and receipts shall use browser print support. Smart locks, barcode readers, payment terminals and point-of-sale devices are outside Version 1.0.

## 3.3 Software Interfaces

**Table 8 - Software Interfaces**

| **Interface**                     | **Data Exchanged**                                           | **Requirement**                                                                          |
|-----------------------------------|--------------------------------------------------------------|------------------------------------------------------------------------------------------|
| Web browser to Next.js            | HTTPS requests, HTML, CSS, JavaScript and form/JSON payloads | Protected routes shall use secure sessions and server-side authorization.                |
| Next.js to PostgreSQL             | Parameterized SQL commands and typed result sets             | Use connection pooling and explicit transactions; ORM-generated SQL is prohibited.       |
| CI/CD to PostgreSQL               | Migrations, seed scripts and automated database tests        | Every migration shall be applied to a clean database before deployment.                  |
| Application to logging/monitoring | Structured request, error and deployment events              | Secrets and sensitive guest data shall be redacted.                                      |
| Report export                     | CSV and print-friendly report representations                | Exported rows and totals shall match the selected screen filters.                        |
| Seed/import scripts               | Validated SQL or controlled data files                       | Scripts shall be deterministic or safely repeatable and shall reject invalid references. |

## 3.4 Communications Interfaces

**Table 9 - Communications Interface Requirements**

| **ID**    | **Requirement**                                                                                     | **Priority and Verification**                  |
|-----------|-----------------------------------------------------------------------------------------------------|------------------------------------------------|
| IR-COM-01 | All deployed browser traffic shall use HTTPS.                                                       | High; Configuration inspection                 |
| IR-COM-02 | Database traffic shall use a private network or equivalently protected connection.                  | High; Deployment inspection                    |
| IR-COM-03 | Data-changing requests shall require authentication, authorization and CSRF-safe controls.          | High; Security test                            |
| IR-COM-04 | Application/database communication shall use UTF-8 text and unambiguous ISO-style dates/timestamps. | High; Integration test                         |
| IR-COM-05 | A network failure during a transaction shall cause rollback and a retry-safe user response.         | High; Fault-injection test                     |
| IR-COM-06 | The browser shall never receive database credentials or a direct database connection.               | Critical; Architecture and security inspection |

# 4. System Features

The functional requirements are organized by major system feature in accordance with the supplied SRS template. Each feature contains a description and priority, a stimulus/response sequence presented as a detailed use case, and uniquely identified functional requirements that can be verified independently.

<img src="SkyNest_HRGSMS_SRS_assets/image4.png" style="width:5.55in;height:1.8628in" />

**Figure 4 - Level-0 Data Flow Diagram**

## 4.1 Authentication and Role-Based Access Control

### 4.1.1 Description and Priority

Description and priority: High. The feature protects all staff functions and restricts operations by role and branch. Authentication does not replace database constraints; users with valid sessions still cannot create inconsistent records.

### 4.1.2 Stimulus/Response Sequences

**Table 10 - Use Case - Authenticate Staff User**

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Field</strong></th>
<th><strong>Description</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Use Case Name</td>
<td>Authenticate Staff User</td>
</tr>
<tr class="even">
<td>Primary Actors</td>
<td>Front Desk Staff, Service Staff, Manager, Administrator, Auditor</td>
</tr>
<tr class="odd">
<td>Trigger</td>
<td>The user opens the login page and submits credentials.</td>
</tr>
<tr class="even">
<td>Preconditions</td>
<td>The user account exists and is active.</td>
</tr>
<tr class="odd">
<td>Basic Flow</td>
<td>1. The system validates that both credential fields are present.<br />
2. The server retrieves the account using a parameterized SQL query.<br />
3. The server verifies the password against the stored password hash.<br />
4. The system checks account status and branch/role assignments.<br />
5. The system creates a secure session and redirects to the permitted dashboard.<br />
6. The login event is recorded in the audit trail.</td>
</tr>
<tr class="even">
<td>Alternative Flows</td>
<td>If the password is incorrect, the system returns a generic failure message.<br />
If the account is disabled, access is denied and the event is logged.<br />
After repeated failures, the account or source may be temporarily throttled.</td>
</tr>
<tr class="odd">
<td>Postconditions</td>
<td>An authenticated session exists with the correct role and branch scope.</td>
</tr>
<tr class="even">
<td>Exception Paths</td>
<td>Database or network failure: no session is created.<br />
Expired session: the user is redirected to login.</td>
</tr>
</tbody>
</table>

### 4.1.3 Functional Requirements

**Table 11 - Authentication and Access Requirements**

| **ID** | **Requirement**                                                                                                                            | **Priority and Verification** |
|--------|--------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------|
| FR-001 | The system shall authenticate staff using a unique username and a securely hashed password.                                                | High; Security test           |
| FR-002 | The system shall associate every staff account with exactly one active role and zero or one home branch, depending on the role.            | High; Database test           |
| FR-003 | The server shall authorize every protected operation, even when the corresponding UI control is hidden.                                    | High; Authorization test      |
| FR-004 | Front desk and service staff shall be limited to records belonging to their assigned branch.                                               | High; Integration test        |
| FR-005 | The system shall expire inactive sessions after a configurable period and shall support explicit logout.                                   | Medium; Session test          |
| FR-006 | The system shall record successful logins, failed logins, logouts and account changes in the audit log.                                    | High; Audit inspection        |
| FR-007 | No user role shall be able to disable database consistency constraints or directly mark a booking checked out with an outstanding balance. | High; Negative test           |

## 4.2 Branch, Room Type, Amenity and Room Management

### 4.2.1 Description and Priority

Description and priority: High. Authorized managers maintain the physical room inventory and commercial attributes used by reservation and billing workflows.

<img src="SkyNest_HRGSMS_SRS_assets/image5.png" style="width:5.55in;height:1.12269in" />

**Figure 5 - Room Operational State Model**

### 4.2.2 Stimulus/Response Sequences

**Table 12 - Use Case - Maintain Room Inventory**

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Field</strong></th>
<th><strong>Description</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Use Case Name</td>
<td>Maintain Room Inventory</td>
</tr>
<tr class="even">
<td>Primary Actors</td>
<td>Branch Manager or System Administrator</td>
</tr>
<tr class="odd">
<td>Trigger</td>
<td>The authorized user selects room administration.</td>
</tr>
<tr class="even">
<td>Preconditions</td>
<td>The user is authenticated and has permission for the target branch.</td>
</tr>
<tr class="odd">
<td>Basic Flow</td>
<td>1. The system displays the branch room list and current status.<br />
2. The user creates or edits a room type, capacity, base rate and amenities.<br />
3. The user creates or edits a room with a unique branch room number.<br />
4. The server validates references, values and duplicate room numbers.<br />
5. The database commits the change and writes an audit event.<br />
6. The refreshed room list is displayed.</td>
</tr>
<tr class="even">
<td>Alternative Flows</td>
<td>A room with future bookings may be marked out of service for a limited date range, but deletion is rejected.<br />
Price changes affect only future bookings; existing rate snapshots remain unchanged.</td>
</tr>
<tr class="odd">
<td>Postconditions</td>
<td>The room catalogue is updated without breaking historical bookings.</td>
</tr>
<tr class="even">
<td>Exception Paths</td>
<td>Duplicate room number: transaction is rejected.<br />
Referenced room type or branch is inactive: change is rejected.</td>
</tr>
</tbody>
</table>

### 4.2.3 Functional Requirements

**Table 13 - Room Inventory Requirements**

| **ID** | **Requirement**                                                                                                                 | **Priority and Verification** |
|--------|---------------------------------------------------------------------------------------------------------------------------------|-------------------------------|
| FR-008 | The system shall store the Colombo, Kandy and Galle branches as separate branch records.                                        | High; Database inspection     |
| FR-009 | The system shall maintain room types with name, capacity, base daily rate and active status.                                    | High; Functional test         |
| FR-010 | The system shall maintain a reusable amenity catalogue and a many-to-many relationship between room types and amenities.        | Medium; Database test         |
| FR-011 | Each room shall belong to one branch and one room type and shall have a room number unique within its branch.                   | High; Constraint test         |
| FR-012 | Room operational status shall be limited to approved values such as AVAILABLE, RESERVED, OCCUPIED, CLEANING and OUT_OF_SERVICE. | High; Constraint test         |
| FR-013 | The system shall support dated room blocks for maintenance, renovation or other non-sellable periods.                           | High; Availability test       |
| FR-014 | A room referenced by booking history shall not be physically deleted; it may be deactivated.                                    | High; Negative database test  |
| FR-015 | Changes to room rates, statuses and blocks shall be audited with user and timestamp.                                            | High; Audit inspection        |

## 4.3 Guest Profile Management

### 4.3.1 Description and Priority

Description and priority: High. The system stores enough information to identify and contact a guest while minimizing unnecessary duplication and sensitive data.

### 4.3.2 Stimulus/Response Sequences

**Table 14 - Use Case - Create or Update Guest Profile**

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Field</strong></th>
<th><strong>Description</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Use Case Name</td>
<td>Create or Update Guest Profile</td>
</tr>
<tr class="even">
<td>Primary Actors</td>
<td>Front Desk Staff</td>
</tr>
<tr class="odd">
<td>Trigger</td>
<td>Staff begins a reservation or opens guest management.</td>
</tr>
<tr class="even">
<td>Preconditions</td>
<td>The user is authenticated for a branch.</td>
</tr>
<tr class="odd">
<td>Basic Flow</td>
<td>1. The user searches by name, email, phone or identity reference.<br />
2. The system displays possible matches without exposing unrelated sensitive details.<br />
3. The user selects an existing guest or starts a new profile.<br />
4. The system validates required fields and canonicalizes email/phone data.<br />
5. The user confirms the changes.<br />
6. The database stores the profile and records an audit event.</td>
</tr>
<tr class="even">
<td>Alternative Flows</td>
<td>When a likely duplicate is found, the system warns the user and requires selection or confirmation.<br />
A guest may be created without email when a valid phone number is present.</td>
</tr>
<tr class="odd">
<td>Postconditions</td>
<td>A unique guest record is available for the booking.</td>
</tr>
<tr class="even">
<td>Exception Paths</td>
<td>Invalid or duplicate identity reference: save is rejected.<br />
Unauthorized branch staff attempts a restricted update: access is denied.</td>
</tr>
</tbody>
</table>

### 4.3.3 Functional Requirements

**Table 15 - Guest Management Requirements**

| **ID** | **Requirement**                                                                                             | **Priority and Verification**      |
|--------|-------------------------------------------------------------------------------------------------------------|------------------------------------|
| FR-016 | The system shall assign every guest a unique internal identifier.                                           | High; Database test                |
| FR-017 | A guest profile shall store full name and at least one usable contact method.                               | High; Validation test              |
| FR-018 | Identity or passport references, when recorded, shall be unique and protected from ordinary report exports. | High; Security and constraint test |
| FR-019 | The system shall search existing guests before allowing creation of a new profile.                          | Medium; UI test                    |
| FR-020 | The system shall show a guest booking and payment history to authorized staff.                              | Medium; Functional test            |
| FR-021 | Guest contact corrections shall not alter historical invoice and booking identifiers.                       | High; Regression test              |
| FR-022 | Guest deactivation shall preserve all legally and academically required historical relations.               | High; Database test                |

## 4.4 Room Availability and Reservation Management

### 4.4.1 Description and Priority

Description and priority: Critical. The feature searches sellable inventory and creates bookings without allowing the same room to be reserved for overlapping active intervals.

<img src="SkyNest_HRGSMS_SRS_assets/image6.png" style="width:5.55in;height:6.96471in" />

**Figure 6 - Reservation Creation Workflow**

<img src="SkyNest_HRGSMS_SRS_assets/image7.png" style="width:5.55in;height:1.34648in" />

**Figure 7 - Booking Status State Model**

### 4.4.2 Stimulus/Response Sequences

**Table 16 - Use Case - Search Availability and Create Booking**

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Field</strong></th>
<th><strong>Description</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Use Case Name</td>
<td>Search Availability and Create Booking</td>
</tr>
<tr class="even">
<td>Primary Actors</td>
<td>Guest or Front Desk Staff</td>
</tr>
<tr class="odd">
<td>Trigger</td>
<td>The user enters a branch, check-in date, check-out date and occupancy criteria.</td>
</tr>
<tr class="even">
<td>Preconditions</td>
<td>Room, room type and branch master data exist.</td>
</tr>
<tr class="odd">
<td>Basic Flow</td>
<td>1. The system validates that check-out is after check-in and dates satisfy policy.<br />
2. The server queries rooms whose capacity is sufficient and that have no active overlapping booking or room block.<br />
3. The system displays available rooms, room types, amenities and rates.<br />
4. The user selects a room and identifies or creates the guest.<br />
5. The user selects the payment method and confirms the reservation.<br />
6. The server executes the controlled booking transaction and rechecks availability.<br />
7. The system records BOOKED status and returns a unique confirmation number.</td>
</tr>
<tr class="even">
<td>Alternative Flows</td>
<td>If another user books the room before commit, the database rejects the conflict and the availability list is refreshed.<br />
A manager may approve an authorized discount within the configured limit.<br />
A booking date or room may be modified only after a fresh overlap check.</td>
</tr>
<tr class="odd">
<td>Postconditions</td>
<td>A committed booking exists with a rate snapshot and no conflicting active booking.</td>
</tr>
<tr class="even">
<td>Exception Paths</td>
<td>Invalid dates, inactive room or capacity mismatch: request is rejected.<br />
Database failure: the transaction is rolled back and no partial booking remains.</td>
</tr>
</tbody>
</table>

### 4.4.3 Functional Requirements

**Table 17 - Availability and Reservation Requirements**

| **ID** | **Requirement**                                                                                                                                            | **Priority and Verification**         |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------|
| FR-023 | The availability search shall accept branch, check-in date, check-out date, guest count and optional room type.                                            | High; Functional test                 |
| FR-024 | The system shall treat check-in as inclusive and check-out as exclusive when detecting overlap.                                                            | High; Boundary test                   |
| FR-025 | A room shall be returned as available only when it is active, capacity is sufficient, no room block overlaps and no BOOKED or CHECKED_IN booking overlaps. | High; SQL integration test            |
| FR-026 | The database shall enforce the no-overlap rule independently of application validation.                                                                    | Critical; Concurrent transaction test |
| FR-027 | Every booking shall reference one guest, one room and one branch-derived room location.                                                                    | High; Foreign-key test                |
| FR-028 | The booking shall store the agreed daily rate as a snapshot.                                                                                               | High; Regression test                 |
| FR-029 | The system shall generate a human-readable booking reference unique across the chain.                                                                      | High; Constraint test                 |
| FR-030 | Booking status shall be limited to BOOKED, CHECKED_IN, CHECKED_OUT, CANCELLED and NO_SHOW.                                                                 | High; Constraint test                 |
| FR-031 | Modifying booking dates or room shall perform the same availability and overlap checks as creation.                                                        | High; Functional test                 |
| FR-032 | The system shall record every booking status change with old status, new status, user, timestamp and reason.                                               | High; Audit test                      |
| FR-033 | The system shall support an optional group reference that links multiple independent room bookings.                                                        | Medium; Functional test               |
| FR-034 | The system shall reject a booking when guest count exceeds room-type capacity.                                                                             | High; Negative test                   |

## 4.5 Guest Check-In and Active Stay Management

### 4.5.1 Description and Priority

Description and priority: High. Check-in confirms the booking and changes the room to occupied within the same database transaction.

<img src="SkyNest_HRGSMS_SRS_assets/image8.png" style="width:5.55in;height:3.83763in" />

**Figure 8 - Guest Check-In Workflow**

### 4.5.2 Stimulus/Response Sequences

**Table 18 - Use Case - Check In Guest**

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Field</strong></th>
<th><strong>Description</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Use Case Name</td>
<td>Check In Guest</td>
</tr>
<tr class="even">
<td>Primary Actors</td>
<td>Front Desk Staff</td>
</tr>
<tr class="odd">
<td>Trigger</td>
<td>The guest arrives and provides a booking reference or identity details.</td>
</tr>
<tr class="even">
<td>Preconditions</td>
<td>The booking is BOOKED, the date is permitted by policy and the room is ready.</td>
</tr>
<tr class="odd">
<td>Basic Flow</td>
<td>1. The user locates the booking and verifies guest details.<br />
2. The system checks booking status, dates, room status and outstanding pre-stay requirements.<br />
3. The user records any deposit or payment received.<br />
4. The server begins an atomic check-in transaction.<br />
5. The booking becomes CHECKED_IN and the room becomes OCCUPIED.<br />
6. Status-history and audit records are inserted.<br />
7. The system displays the active-stay summary.</td>
</tr>
<tr class="even">
<td>Alternative Flows</td>
<td>A manager may approve an early check-in or room reassignment when availability permits.<br />
If the assigned room is unavailable, another suitable room may be assigned after a fresh overlap check.</td>
</tr>
<tr class="odd">
<td>Postconditions</td>
<td>The guest has an active stay and the room is marked occupied.</td>
</tr>
<tr class="even">
<td>Exception Paths</td>
<td>Room already occupied or out of service: transaction is rejected.<br />
Any update failure causes rollback of booking and room status changes.</td>
</tr>
</tbody>
</table>

### 4.5.3 Functional Requirements

**Table 19 - Check-In Requirements**

| **ID** | **Requirement**                                                                                                     | **Priority and Verification**  |
|--------|---------------------------------------------------------------------------------------------------------------------|--------------------------------|
| FR-035 | Only a BOOKED reservation may be checked in through the normal workflow.                                            | High; State-transition test    |
| FR-036 | The system shall verify that the assigned room is not out of service and is ready for occupancy.                    | High; Functional test          |
| FR-037 | Check-in shall atomically set the booking to CHECKED_IN and the room to OCCUPIED.                                   | Critical; Transaction test     |
| FR-038 | The system shall record the actual check-in timestamp and responsible user.                                         | High; Database inspection      |
| FR-039 | An authorized room reassignment shall preserve history and revalidate overlap and capacity.                         | High; Integration test         |
| FR-040 | The system shall show current room, stay dates, guest count, payments and running balance for a checked-in booking. | Medium; UI test                |
| FR-041 | A failed check-in shall not leave the booking and room in different states.                                         | Critical; Fault-injection test |

## 4.6 Chargeable Guest Service Management

### 4.6.1 Description and Priority

Description and priority: High. The service catalogue is centrally maintained, while each usage record preserves the price charged at the time of consumption.

<img src="SkyNest_HRGSMS_SRS_assets/image9.png" style="width:5.55in;height:4.8396in" />

**Figure 9 - Service Usage Recording Workflow**

### 4.6.2 Stimulus/Response Sequences

**Table 20 - Use Case - Record Service Usage**

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Field</strong></th>
<th><strong>Description</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Use Case Name</td>
<td>Record Service Usage</td>
</tr>
<tr class="even">
<td>Primary Actors</td>
<td>Service Staff or Front Desk Staff</td>
</tr>
<tr class="odd">
<td>Trigger</td>
<td>A checked-in guest requests or consumes a chargeable service.</td>
</tr>
<tr class="even">
<td>Preconditions</td>
<td>The service is active and the booking is CHECKED_IN.</td>
</tr>
<tr class="odd">
<td>Basic Flow</td>
<td>1. The user locates the booking by room or booking reference.<br />
2. The system confirms that the booking is active.<br />
3. The user selects the service and enters quantity and usage time.<br />
4. The server retrieves the current service price.<br />
5. The database inserts a service_usage record with a price snapshot.<br />
6. The running bill is recalculated for display.<br />
7. The action is audited.</td>
</tr>
<tr class="even">
<td>Alternative Flows</td>
<td>A manager may void an erroneous entry by creating an auditable reversal; the original record is retained.<br />
A service may be made unavailable without changing historical usages.</td>
</tr>
<tr class="odd">
<td>Postconditions</td>
<td>The usage contributes to the guest bill and service reports.</td>
</tr>
<tr class="even">
<td>Exception Paths</td>
<td>Booking not checked in: usage is rejected.<br />
Quantity or price is invalid: usage is rejected.</td>
</tr>
</tbody>
</table>

### 4.6.3 Functional Requirements

**Table 21 - Guest Service Requirements**

| **ID** | **Requirement**                                                                                                            | **Priority and Verification** |
|--------|----------------------------------------------------------------------------------------------------------------------------|-------------------------------|
| FR-042 | The service catalogue shall contain at least six services, including room service, spa, laundry and minibar-related items. | High; Seed-data inspection    |
| FR-043 | Each service shall have a unique name, current price, category and active status.                                          | High; Constraint test         |
| FR-044 | Service usage shall be recorded only against a CHECKED_IN booking.                                                         | High; Negative test           |
| FR-045 | Each service usage shall store service, usage timestamp, quantity and unit-price snapshot.                                 | High; Database test           |
| FR-046 | Service charges shall equal quantity multiplied by the stored unit-price snapshot.                                         | High; Calculation test        |
| FR-047 | Historical usage charges shall not change when the service catalogue price changes.                                        | Critical; Regression test     |
| FR-048 | Voids and corrections shall be auditable and shall not silently delete the original financial event.                       | High; Audit test              |

## 4.7 Billing, Invoicing and Payment Management

### 4.7.1 Description and Priority

Description and priority: Critical. The feature calculates the complete bill, records partial payments and exposes the outstanding balance at all times.

<img src="SkyNest_HRGSMS_SRS_assets/image10.png" style="width:5.55in;height:1.19797in" />

**Figure 10 - Billing Calculation Model**

### 4.7.2 Stimulus/Response Sequences

**Table 22 - Use Case - Generate Bill and Record Payment**

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Field</strong></th>
<th><strong>Description</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Use Case Name</td>
<td>Generate Bill and Record Payment</td>
</tr>
<tr class="even">
<td>Primary Actors</td>
<td>Front Desk Staff</td>
</tr>
<tr class="odd">
<td>Trigger</td>
<td>Staff opens the financial summary for a booked or checked-in stay.</td>
</tr>
<tr class="even">
<td>Preconditions</td>
<td>The booking exists and the user has branch-level financial permission.</td>
</tr>
<tr class="odd">
<td>Basic Flow</td>
<td>1. The server calculates billable nights and room charge from the booking rate snapshot.<br />
2. The server sums all non-void service usage charges.<br />
3. Approved discounts, service charge, tax and late-checkout lines are applied using configured rules.<br />
4. The system creates or refreshes the invoice and line-item snapshot.<br />
5. The user records a payment with amount, method and reference.<br />
6. The database validates and inserts the payment in a transaction.<br />
7. The system recalculates and displays paid amount and outstanding balance.</td>
</tr>
<tr class="even">
<td>Alternative Flows</td>
<td>The guest may make multiple partial payments.<br />
An overpayment is rejected unless a documented refund/credit process is enabled.<br />
A failed payment may be stored with FAILED status but does not reduce the balance.</td>
</tr>
<tr class="odd">
<td>Postconditions</td>
<td>The invoice and payment history accurately show the current balance.</td>
</tr>
<tr class="even">
<td>Exception Paths</td>
<td>Invalid amount or inactive booking: payment is rejected.<br />
Concurrent payment causes balance recheck before commit.</td>
</tr>
</tbody>
</table>

### 4.7.3 Functional Requirements

**Table 23 - Billing and Payment Requirements**

| **ID** | **Requirement**                                                                                                               | **Priority and Verification** |
|--------|-------------------------------------------------------------------------------------------------------------------------------|-------------------------------|
| FR-049 | Room charge shall equal the booking rate snapshot multiplied by billable nights.                                              | Critical; Calculation test    |
| FR-050 | Service charge subtotal shall equal the sum of valid service usage line amounts.                                              | Critical; Calculation test    |
| FR-051 | The system shall support configurable discounts, service charge, tax and late-checkout adjustments as separate invoice lines. | High; Functional test         |
| FR-052 | Every invoice shall contain a unique invoice number and one or more immutable line-item descriptions and amounts.             | High; Database test           |
| FR-053 | A booking may have multiple payment records, including at least three partial-payment examples in the seed data.              | High; Seed-data inspection    |
| FR-054 | A successful payment shall store amount, method, date/time, reference and recording user.                                     | High; Database test           |
| FR-055 | Outstanding balance shall equal invoice total minus successful payments.                                                      | Critical; Calculation test    |
| FR-056 | Bookings with a positive outstanding balance shall be visibly flagged.                                                        | High; UI and report test      |
| FR-057 | The system shall reject zero, negative or unauthorized overpayment amounts.                                                   | High; Negative test           |
| FR-058 | Financial corrections shall use documented void/reversal records and shall be audited.                                        | High; Audit test              |

## 4.8 Checkout, Cancellation and No-Show Management

### 4.8.1 Description and Priority

Description and priority: Critical. Checkout is allowed only after the final amount has been calculated and fully paid. Cancellation and no-show transitions release future inventory while preserving history.

<img src="SkyNest_HRGSMS_SRS_assets/image11.png" style="width:5.55in;height:5.45in" />

**Figure 11 - Checkout and Final Billing Workflow**

### 4.8.2 Stimulus/Response Sequences

**Table 24 - Use Case - Check Out Guest**

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Field</strong></th>
<th><strong>Description</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Use Case Name</td>
<td>Check Out Guest</td>
</tr>
<tr class="even">
<td>Primary Actors</td>
<td>Front Desk Staff</td>
</tr>
<tr class="odd">
<td>Trigger</td>
<td>The guest is ready to depart.</td>
</tr>
<tr class="even">
<td>Preconditions</td>
<td>The booking is CHECKED_IN and all service entries are complete.</td>
</tr>
<tr class="odd">
<td>Basic Flow</td>
<td>1. The system recalculates the final invoice from authoritative records.<br />
2. The system displays each charge, payment and outstanding balance.<br />
3. The user records any final payment.<br />
4. The server verifies that the balance is exactly zero within currency rounding rules.<br />
5. The checkout procedure sets the booking to CHECKED_OUT.<br />
6. The room changes to CLEANING and an actual checkout timestamp is stored.<br />
7. The system issues the final invoice and payment receipt.</td>
</tr>
<tr class="even">
<td>Alternative Flows</td>
<td>A manager may add an approved late-checkout charge before payment.<br />
After housekeeping completion, authorized staff change the room from CLEANING to AVAILABLE.</td>
</tr>
<tr class="odd">
<td>Postconditions</td>
<td>The booking is checked out, the balance is zero and the room is released to cleaning.</td>
</tr>
<tr class="even">
<td>Exception Paths</td>
<td>Positive balance: checkout is blocked.<br />
Transaction failure: booking remains CHECKED_IN and room remains OCCUPIED.</td>
</tr>
</tbody>
</table>

### 4.8.3 Functional Requirements

**Table 25 - Checkout and Cancellation Requirements**

| **ID** | **Requirement**                                                                                                                | **Priority and Verification** |
|--------|--------------------------------------------------------------------------------------------------------------------------------|-------------------------------|
| FR-059 | The system shall block checkout while outstanding balance is greater than zero.                                                | Critical; Negative test       |
| FR-060 | Checkout shall atomically set the booking to CHECKED_OUT and room to CLEANING.                                                 | Critical; Transaction test    |
| FR-061 | The system shall record actual checkout time and responsible user.                                                             | High; Database inspection     |
| FR-062 | A BOOKED reservation may be cancelled according to the configured policy and shall release inventory immediately after commit. | High; Availability test       |
| FR-063 | The cancellation record shall preserve cancellation time, user, reason and applicable fee.                                     | High; Audit test              |
| FR-064 | A BOOKED reservation may be marked NO_SHOW only after the configured arrival cutoff.                                           | Medium; State-transition test |
| FR-065 | A checked-out, cancelled or no-show booking shall not return to an active state through ordinary UI operations.                | High; Negative test           |

## 4.9 Management Reports and Operational Dashboards

### 4.9.1 Description and Priority

Description and priority: High. Reports shall be produced from SQL views or reviewed queries so that figures remain consistent across the UI, exports and demonstrations.

<img src="SkyNest_HRGSMS_SRS_assets/image12.png" style="width:5.55in;height:0.21872in" />

**Figure 12 - Reporting Data Flow**

### 4.9.2 Stimulus/Response Sequences

**Table 26 - Use Case - Generate Management Report**

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Field</strong></th>
<th><strong>Description</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Use Case Name</td>
<td>Generate Management Report</td>
</tr>
<tr class="even">
<td>Primary Actors</td>
<td>Branch Manager, Chain Manager or Auditor</td>
</tr>
<tr class="odd">
<td>Trigger</td>
<td>The user selects a report and enters branch/date filters.</td>
</tr>
<tr class="even">
<td>Preconditions</td>
<td>The user is authenticated and has report permission.</td>
</tr>
<tr class="odd">
<td>Basic Flow</td>
<td>1. The system validates the filter range.<br />
2. The server executes the approved reporting view or query.<br />
3. The system displays rows, totals, formulas and filter context.<br />
4. The user may sort or paginate the result.<br />
5. The user may export CSV or open a print view.<br />
6. The report execution is logged when it contains financial or sensitive information.</td>
</tr>
<tr class="even">
<td>Alternative Flows</td>
<td>Branch managers receive only their branch data.<br />
Chain managers may compare all branches.<br />
If the result is empty, the system shows a clear no-data message rather than zeroing unrelated totals.</td>
</tr>
<tr class="odd">
<td>Postconditions</td>
<td>The requested report is displayed with reproducible totals.</td>
</tr>
<tr class="even">
<td>Exception Paths</td>
<td>Query timeout: the system returns an error and does not display partial totals.<br />
Unauthorized branch filter: access is denied.</td>
</tr>
</tbody>
</table>

### 4.9.3 Functional Requirements

**Table 27 - Reporting Requirements**

| **ID** | **Requirement**                                                                                          | **Priority and Verification** |
|--------|----------------------------------------------------------------------------------------------------------|-------------------------------|
| FR-066 | The system shall produce room occupancy for a selected date or period by branch and room type.           | High; Report verification     |
| FR-067 | Occupancy percentage shall equal occupied room-nights divided by sellable room-nights multiplied by 100. | High; Calculation test        |
| FR-068 | The system shall produce a guest billing summary showing invoice total, paid amount and unpaid balance.  | High; Report verification     |
| FR-069 | The system shall produce service usage by room, booking, service category and service name.              | High; Report verification     |
| FR-070 | The system shall produce monthly room and service revenue by branch.                                     | High; Report verification     |
| FR-071 | The system shall show top-used services and guest preference trends by usage quantity and revenue.       | High; Report verification     |
| FR-072 | Every report shall display its date range, branch scope and generation time.                             | Medium; UI inspection         |
| FR-073 | Report exports shall reproduce the same filtered rows and totals as the screen.                          | High; Export comparison test  |

## 4.10 Administration, Configuration and Audit

### 4.10.1 Description and Priority

Description and priority: High. The feature manages reference data and provides evidence of important changes without permitting audit records to be silently rewritten.

### 4.10.2 Stimulus/Response Sequences

**Table 28 - Use Case - Manage User Account and Review Audit Trail**

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Field</strong></th>
<th><strong>Description</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Use Case Name</td>
<td>Manage User Account and Review Audit Trail</td>
</tr>
<tr class="even">
<td>Primary Actors</td>
<td>System Administrator or Auditor</td>
</tr>
<tr class="odd">
<td>Trigger</td>
<td>The authorized user opens administration.</td>
</tr>
<tr class="even">
<td>Preconditions</td>
<td>The user has the required administrative permission.</td>
</tr>
<tr class="odd">
<td>Basic Flow</td>
<td>1. The administrator searches or creates a staff account.<br />
2. The administrator assigns role, branch and active status.<br />
3. The system validates unique username and role/branch rules.<br />
4. The database stores the account change and an audit event.<br />
5. An auditor filters audit records by date, user, action or entity.<br />
6. The system displays before/after summaries for supported changes.</td>
</tr>
<tr class="even">
<td>Alternative Flows</td>
<td>Disabling an account invalidates future access without deleting historical actions.<br />
Auditors may view but not alter operational and audit records.</td>
</tr>
<tr class="odd">
<td>Postconditions</td>
<td>The administrative change is effective and traceable.</td>
</tr>
<tr class="even">
<td>Exception Paths</td>
<td>Attempt to edit or delete audit records through the application: denied.<br />
Invalid role/branch combination: rejected.</td>
</tr>
</tbody>
</table>

### 4.10.3 Functional Requirements

**Table 29 - Administration and Audit Requirements**

| **ID** | **Requirement**                                                                                                                                  | **Priority and Verification** |
|--------|--------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------|
| FR-074 | Administrators shall create, disable and reactivate staff accounts without deleting their historical actions.                                    | High; Functional test         |
| FR-075 | Roles and permissions shall be maintained in database reference tables or equivalent controlled configuration.                                   | High; Database inspection     |
| FR-076 | Business configuration shall include cancellation, discount, service-charge, tax and late-checkout settings with effective dates where required. | Medium; Functional test       |
| FR-077 | The system shall audit inserts, updates, status changes and financial reversals for critical entities.                                           | High; Audit test              |
| FR-078 | Audit entries shall include user, timestamp, action, entity, entity identifier and relevant before/after values.                                 | High; Database inspection     |
| FR-079 | Ordinary application users shall not update or delete audit records.                                                                             | High; Security test           |
| FR-080 | Administrative configuration changes shall take effect only after a successful transaction.                                                      | High; Transaction test        |

# 5. Other Nonfunctional Requirements

## 5.1 Performance Requirements

**Table 30 - Performance Requirements**

| **ID**  | **Requirement**                                                                                                                                        | **Priority and Verification**       |
|---------|--------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------|
| NFR-001 | For a database containing 100,000 bookings, a typical branch/date availability search shall complete within 2 seconds at the server under normal load. | High; Performance test              |
| NFR-002 | Login, guest search, booking retrieval and payment posting shall normally complete within 2 seconds, excluding network latency.                        | High; Performance test              |
| NFR-003 | Mandatory reports for a one-year range shall complete within 5 seconds for the academic dataset and within 15 seconds for the target test dataset.     | Medium; Performance test            |
| NFR-004 | The system shall support at least 50 concurrent authenticated staff sessions without data inconsistency.                                               | Medium; Load test                   |
| NFR-005 | Long report queries shall not block booking creation for an unacceptable period.                                                                       | High; Concurrency test              |
| NFR-006 | The application shall use connection pooling and shall release connections after each request/transaction.                                             | High; Code inspection and load test |

## 5.2 Safety Requirements

**Table 31 - Safety Requirements**

| **ID**     | **Requirement**                                                                                                                  | **Priority and Verification**                |
|------------|----------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------|
| NFR-SAF-01 | The system shall require confirmation before cancellation, checkout, payment reversal, room deactivation or user deactivation.   | High; UI and workflow test                   |
| NFR-SAF-02 | A failed multi-step operation shall roll back and shall not leave a room, booking, invoice or payment in a misleading state.     | Critical; Fault-injection test               |
| NFR-SAF-03 | The system shall not mark a room AVAILABLE while an active checked-in booking exists for that room.                              | Critical; Database and state-transition test |
| NFR-SAF-04 | The system shall protect financial and audit history from ordinary deletion and shall use reversal/void records for corrections. | High; Permission and audit test              |
| NFR-SAF-05 | Backup and recovery procedures shall be verified before final production use so operational data can be restored after failure.  | High; Restore demonstration                  |

## 5.3 Security Requirements

**Table 32 - Security Requirements**

| **ID**  | **Requirement**                                                                                                       | **Priority and Verification**            |
|---------|-----------------------------------------------------------------------------------------------------------------------|------------------------------------------|
| NFR-007 | All SQL commands that contain user input shall be parameterized.                                                      | Critical; Code review and injection test |
| NFR-008 | Database credentials and secrets shall be stored in environment/secret management, never committed to source control. | Critical; Repository scan                |
| NFR-009 | Passwords shall be stored only as strong one-way hashes with per-password salt.                                       | Critical; Security inspection            |
| NFR-010 | The production database account used by the app shall have only the permissions required by the application.          | High; Database privilege inspection      |
| NFR-011 | Sensitive guest identity data shall be masked in ordinary lists and excluded from non-essential exports and logs.     | High; Security test                      |
| NFR-012 | Authentication cookies shall be secure, HTTP-only and configured with an appropriate same-site policy.                | High; Configuration inspection           |
| NFR-013 | The application shall protect data-changing requests against cross-site request forgery and unauthorized replay.      | High; Security test                      |
| NFR-014 | Production error responses shall not expose internal paths, SQL text, stack traces or secrets.                        | High; Negative test                      |
| NFR-015 | Critical security and financial actions shall be auditable.                                                           | High; Audit inspection                   |

## 5.4 Software Quality Attributes

The following quality attributes supplement the performance, safety and security requirements and define measurable expectations for reliability, usability, maintainability, portability and observability.

### 5.4.1 Reliability, Availability and Data Quality

**Table 33 - Reliability Requirements**

| **ID**  | **Requirement**                                                                                                                        | **Priority and Verification**  |
|---------|----------------------------------------------------------------------------------------------------------------------------------------|--------------------------------|
| NFR-016 | The system shall preserve database consistency after application crash, network interruption or rejected transaction.                  | Critical; Fault-injection test |
| NFR-017 | Application health checks shall verify the web service and database connectivity without exposing sensitive details.                   | Medium; Deployment test        |
| NFR-018 | The deployed system should achieve 99% availability during agreed demonstration and evaluation periods, excluding planned maintenance. | Medium; Monitoring record      |
| NFR-019 | All timestamps shall be stored consistently and displayed in the hotel operational timezone.                                           | High; Integration test         |
| NFR-020 | Currency calculations shall round using one documented rule and shall reconcile invoice lines, totals and payments exactly.            | Critical; Calculation test     |
| NFR-021 | Validation rules shall be implemented at both server and database layers when inconsistency would be harmful.                          | High; Code/schema review       |

### 5.4.2 Usability and Accessibility

**Table 34 - Usability Requirements**

| **ID**  | **Requirement**                                                                                                                        | **Priority and Verification**    |
|---------|----------------------------------------------------------------------------------------------------------------------------------------|----------------------------------|
| NFR-022 | A trained front-desk user shall be able to create a normal booking, check in, record payment and check out without database knowledge. | High; Usability test             |
| NFR-023 | Primary screens shall use consistent labels, status names and date/money formats.                                                      | High; UI inspection              |
| NFR-024 | Keyboard focus, labels and contrast shall support basic accessibility for staff users.                                                 | Medium; Accessibility inspection |
| NFR-025 | Confirmation dialogs shall be used for cancellation, void, checkout and user deactivation.                                             | High; UI test                    |
| NFR-026 | Validation messages shall identify the problem and the corrective action.                                                              | High; UI test                    |

### 5.4.3 Maintainability and Testability

**Table 35 - Maintainability Requirements**

| **ID**  | **Requirement**                                                                                                           | **Priority and Verification**   |
|---------|---------------------------------------------------------------------------------------------------------------------------|---------------------------------|
| NFR-027 | Database changes shall be represented by ordered, version-controlled SQL migration files.                                 | Critical; Repository inspection |
| NFR-028 | SQL shall follow the naming and formatting conventions in Section 6.1.13.                                                 | Medium; Code review             |
| NFR-029 | Complex queries, procedures, functions and triggers shall include comments describing purpose and assumptions.            | High; Code review               |
| NFR-030 | The application shall separate UI, domain logic and SQL access responsibilities.                                          | High; Architecture review       |
| NFR-031 | Automated tests shall cover overlap prevention, status transitions, billing totals, partial payments and report formulas. | Critical; Test report           |
| NFR-032 | The seed script shall produce deterministic demonstration data on a clean database.                                       | High; Repeatability test        |

### 5.4.4 Portability, Scalability and Compatibility

**Table 36 - Portability Requirements**

| **ID**  | **Requirement**                                                                                            | **Priority and Verification**  |
|---------|------------------------------------------------------------------------------------------------------------|--------------------------------|
| NFR-033 | The application shall be deployable on a standard Linux-based Node.js host or container environment.       | High; Deployment test          |
| NFR-034 | The database shall run on PostgreSQL without proprietary hosted platform dependencies.                     | High; Environment test         |
| NFR-035 | Environment-specific values shall be externalized from source code.                                        | High; Configuration inspection |
| NFR-036 | The design shall allow additional branches, rooms, services and users without schema redesign.             | High; Design review            |
| NFR-037 | The responsive web interface shall support current major desktop browsers used by the team and evaluators. | Medium; Compatibility test     |

### 5.4.5 Logging and Monitoring

**Table 37 - Logging Requirements**

| **ID**  | **Requirement**                                                                                                                          | **Priority and Verification**    |
|---------|------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------|
| NFR-038 | The application shall produce structured logs for requests, errors, deployments and database failures.                                   | High; Log inspection             |
| NFR-039 | Logs shall include correlation identifiers but shall not contain passwords, secrets, full identity references or payment-sensitive data. | Critical; Security inspection    |
| NFR-040 | Production health and error conditions shall be observable by the project team.                                                          | Medium; Monitoring demonstration |
| NFR-041 | Audit logs and technical logs shall be distinguishable because they serve different purposes.                                            | High; Design review              |

## 5.5 Business Rules

**Table 38 - Business Rules**

| **ID** | **Requirement**                                                                                                                             | **Priority and Verification**        |
|--------|---------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------|
| BR-001 | A room may have only one active BOOKED or CHECKED_IN booking for any point in the same stay interval.                                       | Critical; Concurrent database test   |
| BR-002 | Check-in date is inclusive and check-out date is exclusive; checkout must be later than check-in.                                           | High; Boundary test                  |
| BR-003 | Guest count shall not exceed the capacity of the selected room type.                                                                        | High; Procedure test                 |
| BR-004 | A booking may be checked in only when it is BOOKED, the date is allowed by policy, and the room is ready.                                   | High; State-transition test          |
| BR-005 | Service usage may be charged only to a CHECKED_IN booking and shall store the price effective at usage time.                                | High; Procedure/trigger test         |
| BR-006 | Room charge equals the agreed rate snapshot multiplied by billable nights.                                                                  | Critical; Calculation test           |
| BR-007 | Only successful payments reduce the outstanding balance; partial payments are permitted.                                                    | Critical; Calculation test           |
| BR-008 | Checkout shall be rejected while the outstanding balance is positive.                                                                       | Critical; Negative test              |
| BR-009 | Checkout shall change the booking to CHECKED_OUT and the room to CLEANING in one transaction.                                               | Critical; Transaction test           |
| BR-010 | Historical bookings, service prices, invoice lines, payments and audit evidence shall not be silently rewritten by later catalogue changes. | High; Regression and permission test |
| BR-011 | Branch-scoped staff may operate only on records belonging to their assigned branch.                                                         | High; Authorization test             |
| BR-012 | Cancellation, discount, tax, service charge and late-checkout rules shall be controlled configuration approved by management.               | High; Configuration test             |

# 6. Other Requirements

## 6.1 Database Requirements and Design

### 6.1.1 Database Objectives

The database is the core assessed component of the project. It shall represent hotel operations in normalized relations, enforce referential and domain integrity, protect against concurrent overbooking, preserve financial history and support efficient reports. The application must not be able to create an invalid state merely by bypassing a client-side validation rule.

<img src="SkyNest_HRGSMS_SRS_assets/image13.png" style="width:5.55in;height:2.73059in" />

**Figure 13 - Database Object and Responsibility Map**

### 6.1.2 Conceptual Data Model

<img src="SkyNest_HRGSMS_SRS_assets/image14.png" style="width:5.55in;height:0.3772in" />

**Figure 14 - Core Reservation Entity-Relationship Model**

<img src="SkyNest_HRGSMS_SRS_assets/image15.png" style="width:5.55in;height:0.92286in" />

**Figure 15 - Service, Billing, Security and Audit Entity-Relationship Model**

The conceptual model separates stable master data (branch, room type, room, service and role), party data (guest and user account), operational events (booking, service usage and payment), financial snapshots (invoice and invoice line) and histories/audits. Relationships use primary and foreign keys. Many-to-many relations, such as room-type amenities, are resolved through junction tables.

### 6.1.3 Proposed Relational Schema

**Table 39 - Entity Summary**

| **Entity**             | **Primary Key**            | **Important Foreign Keys**          | **Purpose**                                        |
|------------------------|----------------------------|-------------------------------------|----------------------------------------------------|
| branch                 | branch_id                  | None                                | Hotel branch master data.                          |
| room_type              | room_type_id               | None                                | Capacity, base rate and room category.             |
| amenity                | amenity_id                 | None                                | Reusable amenity catalogue.                        |
| room_type_amenity      | (room_type_id, amenity_id) | room_type_id, amenity_id            | Resolves room-type/amenity many-to-many relation.  |
| room                   | room_id                    | branch_id, room_type_id             | Physical hotel room and operational status.        |
| room_block             | block_id                   | room_id, created_by                 | Maintenance or other non-sellable interval.        |
| guest                  | guest_id                   | None                                | Guest identity and contact data.                   |
| booking                | booking_id                 | guest_id, room_id, created_by       | Reservation and stay interval with rate snapshot.  |
| booking_status_history | history_id                 | booking_id, changed_by              | Immutable booking-state transitions.               |
| room_status_history    | room_history_id            | room_id, changed_by                 | Operational room-state transitions.                |
| service                | service_id                 | None                                | Chargeable service catalogue.                      |
| service_usage          | usage_id                   | booking_id, service_id, recorded_by | Service event with price snapshot.                 |
| invoice                | invoice_id                 | booking_id                          | Final or provisional invoice header.               |
| invoice_line           | invoice_line_id            | invoice_id                          | Room, service, tax, discount and adjustment lines. |
| payment                | payment_id                 | booking_id, recorded_by             | Partial or full payment event.                     |
| role                   | role_id                    | None                                | Controlled staff role list.                        |
| user_account           | user_id                    | role_id, branch_id                  | Authentication and authorization record.           |
| audit_log              | audit_id                   | user_id                             | Append-only evidence of critical changes.          |
| system_config          | config_key                 | updated_by                          | Versioned business settings.                       |

### 6.1.4 Data Dictionary

The following dictionary lists the most important fields. Implementation scripts may add technical timestamps, soft-delete flags and generated display references, but shall not remove the specified keys or business constraints.

**Table 40 - Core Data Dictionary**

| **Entity**    | **Column and Type**               | **Constraints**                      | **Meaning**                                |
|---------------|-----------------------------------|--------------------------------------|--------------------------------------------|
| branch        | branch_id BIGINT                  | PK, generated                        | Internal branch identifier.                |
| branch        | name VARCHAR(100)                 | UNIQUE, NOT NULL                     | Branch name.                               |
| branch        | city VARCHAR(80)                  | NOT NULL                             | Colombo, Kandy or Galle for baseline data. |
| branch        | address TEXT                      | NOT NULL                             | Operational address.                       |
| branch        | active BOOLEAN                    | NOT NULL DEFAULT TRUE                | Controls use in new bookings.              |
| room_type     | room_type_id BIGINT               | PK, generated                        | Room category identifier.                  |
| room_type     | name VARCHAR(60)                  | UNIQUE, NOT NULL                     | Single, Double, Suite or other category.   |
| room_type     | capacity SMALLINT                 | CHECK \> 0                           | Maximum guest count.                       |
| room_type     | base_daily_rate NUMERIC(12,2)     | CHECK \>= 0                          | Current catalogue rate.                    |
| room          | room_id BIGINT                    | PK, generated                        | Physical room identifier.                  |
| room          | branch_id BIGINT                  | FK branch, NOT NULL                  | Owning branch.                             |
| room          | room_type_id BIGINT               | FK room_type, NOT NULL               | Current room type.                         |
| room          | room_number VARCHAR(20)           | NOT NULL; UNIQUE with branch_id      | Human room number.                         |
| room          | operational_status VARCHAR(20)    | CHECK approved values                | Physical room state.                       |
| guest         | guest_id BIGINT                   | PK, generated                        | Guest identifier.                          |
| guest         | full_name VARCHAR(150)            | NOT NULL                             | Guest legal/display name.                  |
| guest         | email VARCHAR(254)                | NULL allowed                         | Contact email.                             |
| guest         | phone VARCHAR(30)                 | NULL allowed                         | Contact phone.                             |
| guest         | identity_ref VARCHAR(80)          | UNIQUE when present                  | Protected identity/passport reference.     |
| booking       | booking_id BIGINT                 | PK, generated                        | Booking identifier.                        |
| booking       | booking_ref VARCHAR(30)           | UNIQUE, NOT NULL                     | Human-readable confirmation.               |
| booking       | guest_id BIGINT                   | FK guest, NOT NULL                   | Primary guest.                             |
| booking       | room_id BIGINT                    | FK room, NOT NULL                    | Reserved room.                             |
| booking       | check_in_date DATE                | NOT NULL                             | Inclusive stay start.                      |
| booking       | check_out_date DATE               | NOT NULL; CHECK \> check_in_date     | Exclusive stay end.                        |
| booking       | guest_count SMALLINT              | CHECK \> 0                           | Occupancy count.                           |
| booking       | rate_snapshot NUMERIC(12,2)       | CHECK \>= 0                          | Agreed nightly rate.                       |
| booking       | status VARCHAR(20)                | CHECK approved states                | Booking lifecycle state.                   |
| booking       | actual_check_in TIMESTAMPTZ       | Nullable                             | Recorded check-in time.                    |
| booking       | actual_check_out TIMESTAMPTZ      | Nullable                             | Recorded checkout time.                    |
| service       | service_id BIGINT                 | PK, generated                        | Service identifier.                        |
| service       | name VARCHAR(100)                 | UNIQUE, NOT NULL                     | Service catalogue name.                    |
| service       | category VARCHAR(60)              | NOT NULL                             | Room service, spa, laundry, minibar, etc.  |
| service       | current_price NUMERIC(12,2)       | CHECK \>= 0                          | Current catalogue unit price.              |
| service_usage | usage_id BIGINT                   | PK, generated                        | Service event identifier.                  |
| service_usage | booking_id BIGINT                 | FK booking, NOT NULL                 | Active stay charged.                       |
| service_usage | service_id BIGINT                 | FK service, NOT NULL                 | Consumed service.                          |
| service_usage | used_at TIMESTAMPTZ               | NOT NULL                             | Usage date and time.                       |
| service_usage | quantity NUMERIC(10,2)            | CHECK \> 0                           | Units consumed.                            |
| service_usage | unit_price_snapshot NUMERIC(12,2) | CHECK \>= 0                          | Price at usage time.                       |
| invoice       | invoice_id BIGINT                 | PK, generated                        | Invoice identifier.                        |
| invoice       | booking_id BIGINT                 | FK booking, UNIQUE                   | One active final invoice per booking.      |
| invoice       | invoice_number VARCHAR(30)        | UNIQUE, NOT NULL                     | Display invoice number.                    |
| invoice       | total_amount NUMERIC(12,2)        | CHECK \>= 0                          | Snapshot total.                            |
| invoice       | status VARCHAR(20)                | CHECK approved values                | DRAFT, FINAL, PAID or VOID.                |
| invoice_line  | invoice_line_id BIGINT            | PK, generated                        | Charge line identifier.                    |
| invoice_line  | invoice_id BIGINT                 | FK invoice, NOT NULL                 | Owning invoice.                            |
| invoice_line  | line_type VARCHAR(30)             | CHECK approved types                 | ROOM, SERVICE, TAX, DISCOUNT, etc.         |
| invoice_line  | description VARCHAR(255)          | NOT NULL                             | Human-readable explanation.                |
| invoice_line  | amount NUMERIC(12,2)              | Signed amount                        | Positive charge or negative discount.      |
| payment       | payment_id BIGINT                 | PK, generated                        | Payment identifier.                        |
| payment       | booking_id BIGINT                 | FK booking, NOT NULL                 | Booking paid.                              |
| payment       | amount NUMERIC(12,2)              | CHECK \> 0                           | Payment amount.                            |
| payment       | method VARCHAR(30)                | CHECK approved methods               | Cash, card-recorded, bank transfer, etc.   |
| payment       | status VARCHAR(20)                | CHECK approved values                | PENDING, SUCCESS, FAILED or VOID.          |
| user_account  | user_id BIGINT                    | PK, generated                        | Staff user identifier.                     |
| user_account  | username VARCHAR(80)              | UNIQUE, NOT NULL                     | Login name.                                |
| user_account  | password_hash TEXT                | NOT NULL                             | One-way password hash.                     |
| user_account  | role_id BIGINT                    | FK role, NOT NULL                    | Authorization role.                        |
| user_account  | branch_id BIGINT                  | FK branch, nullable                  | Branch scope where applicable.             |
| audit_log     | audit_id BIGINT                   | PK, generated                        | Audit record identifier.                   |
| audit_log     | user_id BIGINT                    | FK user_account, nullable for system | Responsible principal.                     |
| audit_log     | entity_name VARCHAR(80)           | NOT NULL                             | Affected table/domain entity.              |
| audit_log     | entity_id VARCHAR(80)             | NOT NULL                             | Affected record identifier.                |
| audit_log     | action VARCHAR(40)                | NOT NULL                             | INSERT, UPDATE, STATUS_CHANGE, VOID, etc.  |
| audit_log     | changed_at TIMESTAMPTZ            | NOT NULL                             | Audit timestamp.                           |

### 6.1.5 Keys and Integrity Constraints

**Table 41 - Database Integrity Requirements**

| **ID**  | **Requirement**                                                                                                        | **Priority and Verification**        |
|---------|------------------------------------------------------------------------------------------------------------------------|--------------------------------------|
| DBR-001 | Every base table shall have a declared primary key.                                                                    | High; Schema inspection              |
| DBR-002 | All relationships shown in the ER models shall be implemented with foreign keys and appropriate update/delete actions. | High; Schema inspection              |
| DBR-003 | Room number shall be unique within a branch.                                                                           | High; Constraint test                |
| DBR-004 | Booking check_out_date shall be greater than check_in_date.                                                            | High; Constraint test                |
| DBR-005 | Active bookings for the same room shall not have overlapping \[check_in, check_out) date ranges.                       | Critical; Concurrent constraint test |
| DBR-006 | Guest count shall not exceed the room-type capacity at booking/check-in time.                                          | High; Procedure test                 |
| DBR-007 | Money columns shall use exact NUMERIC/DECIMAL types rather than floating-point types.                                  | High; Schema inspection              |
| DBR-008 | Rates and prices used for historical charges shall be stored as snapshots.                                             | Critical; Regression test            |
| DBR-009 | A service usage record shall reference a booking whose state is CHECKED_IN at insert time.                             | High; Trigger/procedure test         |
| DBR-010 | A booking may become CHECKED_OUT only when its outstanding balance is zero.                                            | Critical; Procedure and trigger test |
| DBR-011 | Critical history and audit records shall use restricted delete/update permissions.                                     | High; Permission test                |
| DBR-012 | Reference values such as statuses and methods shall be constrained by lookup tables or CHECK constraints.              | High; Schema inspection              |

### 6.1.6 Normalization Analysis

The design targets Third Normal Form (3NF) and, where practical, Boyce-Codd Normal Form (BCNF). The starting operational form contains guest details, room details, repeating services and repeated payments in one booking record. This causes update, insertion and deletion anomalies. The following decomposition removes those anomalies.

**Table 42 - Normalization Progress**

| **Stage**            | **Problem**                                                                                               | **Decomposition / Result**                                                                                                                   |
|----------------------|-----------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| Unnormalized form    | One reservation form contains repeating service and payment groups.                                       | Identify independent entities and repeating events.                                                                                          |
| First Normal Form    | Repeating groups and multi-valued amenities violate atomicity.                                            | Create service_usage, payment and room_type_amenity rows; each cell is atomic.                                                               |
| Second Normal Form   | Service name/price and amenity description depend on only part of a composite relation.                   | Move service details to service and amenity details to amenity.                                                                              |
| Third Normal Form    | Branch address depends on branch, and capacity/base rate depend on room type rather than room or booking. | Create branch and room_type relations; keep only foreign keys in room.                                                                       |
| BCNF review          | Username, room number within branch and invoice number are candidate keys.                                | Declare UNIQUE constraints so every determinant is a candidate key.                                                                          |
| Controlled snapshots | Rate and price snapshots duplicate current catalogue values.                                              | Retain deliberately because they describe the historical transaction and are functionally dependent on the event, not the current catalogue. |

Derived availability, occupancy, revenue and balance values should normally be exposed through SQL views or functions rather than duplicated in manually editable columns. Invoice totals may be stored as an immutable financial snapshot after finalization, but they must be generated from invoice lines and protected against silent edits.

### 6.1.7 Transaction Management, ACID and Concurrency

<img src="SkyNest_HRGSMS_SRS_assets/image16.png" style="width:5.55in;height:6.20751in" />

**Figure 16 - Booking Transaction and Concurrency Control**

**Table 43 - ACID Application**

| **Property** | **Required Mechanism in HRGSMS**                                                                                                                         |
|--------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| Atomicity    | Multi-table operations such as booking creation, check-in, payment posting and checkout run inside one transaction. Any error causes rollback.           |
| Consistency  | Primary keys, foreign keys, unique/check constraints, exclusion/overlap protection, procedures and triggers preserve valid states.                       |
| Isolation    | Booking and payment procedures recheck current data under row locks or an appropriate isolation level so concurrent requests cannot overbook or overpay. |
| Durability   | Committed records are persisted by PostgreSQL transaction logging and protected by verified backups.                                                     |

**Table 44 - Transaction and Concurrency Requirements**

| **ID**  | **Requirement**                                                                                                                   | **Priority and Verification**         |
|---------|-----------------------------------------------------------------------------------------------------------------------------------|---------------------------------------|
| DBR-013 | Booking creation shall execute as one transaction and shall recheck availability immediately before insert.                       | Critical; Concurrent test             |
| DBR-014 | PostgreSQL implementation shall use an exclusion constraint on room and date range, or an equivalently strong database mechanism. | Critical; Schema and concurrency test |
| DBR-015 | Check-in and checkout shall lock the target booking and room records until commit.                                                | Critical; Transaction test            |
| DBR-016 | Payment posting shall re-read invoice total and successful payment sum before accepting an amount.                                | Critical; Concurrent payment test     |
| DBR-017 | Deadlock or serialization failures shall be rolled back and may be retried safely by the application.                             | High; Fault test                      |
| DBR-018 | No transaction shall leave booking status, room status and status-history records inconsistent.                                   | Critical; Fault-injection test        |

### 6.1.8 Stored Procedures, Functions and Triggers

**Table 45 - Required SQL Objects**

| **Object**                 | **Type**                           | **Responsibility**                                                                  |
|----------------------------|------------------------------------|-------------------------------------------------------------------------------------|
| sp_create_booking          | Procedure / transactional function | Validate room, guest count, dates and conflicts; insert booking and history.        |
| sp_modify_booking          | Procedure / transactional function | Change room or dates after complete availability validation.                        |
| sp_check_in_booking        | Procedure                          | Lock booking/room, validate state, set CHECKED_IN/OCCUPIED and write histories.     |
| sp_record_service_usage    | Procedure                          | Verify active stay and store catalogue price snapshot.                              |
| sp_record_payment          | Procedure                          | Validate payment and current balance; insert payment and audit.                     |
| sp_checkout_booking        | Procedure                          | Finalize invoice, enforce zero balance, set CHECKED_OUT/CLEANING.                   |
| fn_billable_nights         | Function                           | Return check_out_date - check_in_date with approved adjustments.                    |
| fn_room_charge             | Function                           | Return rate_snapshot multiplied by billable nights.                                 |
| fn_service_total           | Function                           | Return sum of valid service usage charges.                                          |
| fn_outstanding_balance     | Function                           | Return invoice total minus successful payments.                                     |
| trg_booking_state_guard    | Trigger                            | Reject invalid status transitions and missing timestamps.                           |
| trg_service_price_snapshot | Trigger                            | Copy current price when a service usage is inserted if procedure did not supply it. |
| trg_room_status_history    | Trigger                            | Write room status changes to immutable history.                                     |
| trg_audit_critical_change  | Trigger                            | Capture critical inserts/updates/voids with the acting user context.                |

Triggers shall be used for cross-cutting integrity and audit safeguards, not to hide all business logic. Procedures and functions shall have clear input/output contracts and shall raise meaningful database errors that the application maps to safe user messages.

### 6.1.9 Indexing and Query Performance

**Table 46 - Index Requirements**

| **ID**  | **Requirement**                                                                                  | **Priority and Verification** |
|---------|--------------------------------------------------------------------------------------------------|-------------------------------|
| DBR-019 | Create a unique index on branch_id and room_number.                                              | High; Schema inspection       |
| DBR-020 | Index booking by room_id, check_in_date and check_out_date for availability checks.              | High; Query-plan inspection   |
| DBR-021 | Index booking by guest_id and created_at for guest history.                                      | Medium; Query-plan inspection |
| DBR-022 | Index booking by status and stay dates for arrival/departure dashboards.                         | High; Performance test        |
| DBR-023 | Index service_usage by booking_id, used_at and service_id.                                       | High; Query-plan inspection   |
| DBR-024 | Index payment by booking_id, status and paid_at.                                                 | High; Query-plan inspection   |
| DBR-025 | Index audit_log by changed_at, user_id and entity_name/entity_id.                                | Medium; Query-plan inspection |
| DBR-026 | Indexes shall be justified by frequent queries and reviewed to avoid unnecessary write overhead. | Medium; Design review         |

### 6.1.10 Reporting Views

**Table 47 - Required Views**

| **View**                  | **Purpose**                                                                        |
|---------------------------|------------------------------------------------------------------------------------|
| v_room_availability       | Derives sellable rooms for a date interval from rooms, blocks and active bookings. |
| v_current_occupancy       | Shows current room/booking/guest occupancy by branch.                              |
| v_guest_billing_summary   | Shows invoice total, successful payments and outstanding balance.                  |
| v_service_usage_breakdown | Aggregates quantity and revenue by branch, room, booking and service.              |
| v_monthly_branch_revenue  | Aggregates finalized room and service invoice lines by branch and month.           |
| v_top_services            | Ranks services by quantity, booking count and revenue.                             |

<img src="SkyNest_HRGSMS_SRS_assets/image12.png" style="width:5.55in;height:0.21872in" />

**Figure 17 - Reporting View and Export Flow**

### 6.1.11 Minimum Seed and Demonstration Data

**Table 48 - Seed Data Baseline**

| **Category**          | **Minimum Content**                                                                    |
|-----------------------|----------------------------------------------------------------------------------------|
| Branches              | Exactly the initial three branches: Colombo, Kandy and Galle.                          |
| Rooms                 | At least 10 rooms distributed across branches and room types.                          |
| Room types            | At least Single, Double and Suite with different capacity and rates.                   |
| Services              | At least 6 active services, including room service, spa, laundry and minibar examples. |
| Guests                | At least 5 guest records.                                                              |
| Bookings              | At least 8 bookings across multiple statuses and non-overlapping periods.              |
| Payments              | At least 3 partial-payment records that leave or later clear an outstanding balance.   |
| Availability / blocks | Room blocks or status records sufficient to demonstrate an unavailable room.           |
| Service usage         | Usage records across multiple rooms and service categories.                            |

### 6.1.12 Backup, Retention and Recovery

<img src="SkyNest_HRGSMS_SRS_assets/image17.png" style="width:5.55in;height:1.24308in" />

**Figure 18 - Backup and Recovery Model**

**Table 49 - Backup and Recovery Requirements**

| **ID**  | **Requirement**                                                                                                     | **Priority and Verification** |
|---------|---------------------------------------------------------------------------------------------------------------------|-------------------------------|
| DBR-027 | Production data shall be backed up on a documented schedule with encrypted storage.                                 | High; Operational inspection  |
| DBR-028 | A backup shall be taken before applying a production migration that changes persistent data.                        | High; Pipeline inspection     |
| DBR-029 | Restore procedures shall be tested in an isolated environment at least once before final project demonstration.     | High; Restore evidence        |
| DBR-030 | The team shall document recovery point and recovery time targets appropriate to the academic deployment.            | Medium; Document review       |
| DBR-031 | Audit and financial records shall be retained for the project lifetime and not removed by ordinary cleanup scripts. | High; Retention test          |

### 6.1.13 SQL and Repository Conventions

- Use lowercase snake_case for SQL tables, columns, indexes, constraints, views and routines.

- Name keys and constraints consistently, such as pk\_\<table\>, fk\_\<table\>\_\<reference\>, uq\_\<table\>\_\<columns\> and ck\_\<table\>\_\<rule\>.

- Prefix views with v\_, functions with fn\_, procedures with sp\_ and triggers with trg\_.

- Keep released migrations ordered and immutable; corrections shall be introduced by a new migration.

- Use explicit INSERT column lists, avoid SELECT \* in production queries and bind every user value as a parameter.

- Use explicit transactions for multi-table state changes and document rollback implications for data-transforming migrations.

- Store only fictional, non-sensitive seed data and never commit database passwords or production connection strings.

## 6.2 Deployment Architecture

<img src="SkyNest_HRGSMS_SRS_assets/image18.png" style="width:5.55in;height:5.75962in" />

**Figure 19 - Target Deployment Architecture**

**Table 50 - Deployment Requirements**

| **ID** | **Requirement**                                                                                | **Priority and Verification**      |
|--------|------------------------------------------------------------------------------------------------|------------------------------------|
| DR-001 | The application and database shall be deployed as separate logical services.                   | High; Deployment inspection        |
| DR-002 | The database shall not be publicly accessible from the Internet.                               | Critical; Network inspection       |
| DR-003 | Production configuration shall be supplied through protected environment variables or secrets. | Critical; Configuration inspection |
| DR-004 | A staging environment shall be available for migration and smoke testing before production.    | High; Pipeline demonstration       |
| DR-005 | Deployments shall produce identifiable build/version information.                              | Medium; Release inspection         |

## 6.3 CI/CD Pipeline

<img src="SkyNest_HRGSMS_SRS_assets/image19.png" style="width:5.55in;height:0.24531in" />

**Figure 20 - Continuous Integration and Deployment Pipeline**

**Table 51 - CI/CD Requirements**

| **ID** | **Requirement**                                                                                              | **Priority and Verification**    |
|--------|--------------------------------------------------------------------------------------------------------------|----------------------------------|
| DR-006 | The pipeline shall run for pull requests and protected-branch updates.                                       | High; Workflow inspection        |
| DR-007 | Continuous integration shall execute linting, unit tests, database integration tests and a production build. | Critical; Pipeline evidence      |
| DR-008 | Database tests shall start a clean PostgreSQL instance, apply all migrations and load controlled test data.  | Critical; Pipeline evidence      |
| DR-009 | A migration failure shall stop deployment.                                                                   | Critical; Negative pipeline test |
| DR-010 | Production deployment shall require an approved branch or manual approval step.                              | High; Workflow inspection        |
| DR-011 | The pipeline shall perform a staging smoke test before production release.                                   | High; Pipeline evidence          |
| DR-012 | The team shall document application rollback and database recovery procedures.                               | High; Document review            |
| DR-013 | Secrets shall be provided by the CI/CD secret store and never printed in logs.                               | Critical; Security inspection    |

## 6.4 Test Requirements

**Table 52 - Required Test Levels**

| **Level**         | **Required Coverage**                                                                         |
|-------------------|-----------------------------------------------------------------------------------------------|
| Unit tests        | Pure billing calculations, validation helpers, authorization decisions and formatting.        |
| Database tests    | DDL constraints, foreign keys, overlap prevention, procedures, functions, triggers and views. |
| Integration tests | Next.js server functions against a real temporary PostgreSQL database.                        |
| Concurrency tests | Simultaneous booking of the same room; simultaneous final payments; check-in/checkout races.  |
| Security tests    | SQL injection attempts, role bypass attempts, secret leakage and invalid sessions.            |
| UI tests          | Critical happy paths and validation/error behavior.                                           |
| Performance tests | Availability queries and reports at target dataset sizes.                                     |
| Deployment tests  | Clean migration, seed, staging smoke test and rollback drill.                                 |

<img src="SkyNest_HRGSMS_SRS_assets/image20.png" style="width:5.55in;height:0.21558in" />

**Figure 21 - Requirements-to-Release Traceability Flow**

### 6.4.1 Requirements Traceability

**Table 53 - Requirements Traceability Matrix**

| **Requirement Group** | **Primary Design Element**                                  | **Verification Evidence**                           |
|-----------------------|-------------------------------------------------------------|-----------------------------------------------------|
| FR-001 to FR-007      | Authentication middleware, user_account, role and audit_log | Security and authorization tests                    |
| FR-008 to FR-015      | branch, room_type, amenity, room and room_block             | Constraint and availability tests                   |
| FR-016 to FR-022      | guest and protected guest routes                            | Validation and privacy tests                        |
| FR-023 to FR-034      | booking, overlap constraint and sp_create_booking           | Boundary and concurrency tests                      |
| FR-035 to FR-041      | check-in procedure and state histories                      | Transaction and fault tests                         |
| FR-042 to FR-048      | service and service_usage with price snapshot               | Calculation and regression tests                    |
| FR-049 to FR-058      | invoice, invoice_line, payment and balance functions        | Financial calculation tests                         |
| FR-059 to FR-065      | checkout/cancellation procedures and state guards           | State-transition and failure tests                  |
| FR-066 to FR-073      | reporting views and exports                                 | Independent SQL reconciliation                      |
| FR-074 to FR-080      | roles, system_config and protected audit log                | Permission and audit tests                          |
| DBR-001 to DBR-031    | DDL, SQL routines, indexes, views and backup controls       | Schema, integration and recovery tests              |
| NFR / DR groups       | Architecture, security controls, deployment and pipeline    | Performance, security, pipeline and review evidence |

## 6.5 Acceptance Criteria

5.  All Critical and High-priority requirements are implemented or formally waived by the evaluator.

6.  Two simultaneous requests cannot create overlapping active bookings for the same room.

7.  Check-in and checkout update booking and room states atomically.

8.  The final bill accurately includes room nights and all non-void service usage.

9.  Checkout is blocked until the balance is zero, while partial payments remain supported.

10. All five mandatory reports match independently verified SQL calculations.

11. The schema demonstrates normalization, keys, constraints, indexing, views, procedures/functions and triggers.

12. The clean setup scripts create the database and load the required minimum seed data.

13. The Next.js application uses raw parameterized SQL and no ORM, Supabase or Firebase.

14. The CI/CD pipeline tests and deploys the complete system to a reachable environment.

### 6.5.1 Key Acceptance Test Catalogue

**Table 54 - Key Acceptance Tests**

| **Test ID** | **Scenario**                                                             | **Expected Result**                                                                |
|-------------|--------------------------------------------------------------------------|------------------------------------------------------------------------------------|
| AT-01       | Create a valid booking for an available room.                            | Booking commits as BOOKED with a rate snapshot and status history.                 |
| AT-02       | Submit two concurrent overlapping bookings for the same room.            | Exactly one commits; the other receives a conflict.                                |
| AT-03       | Book adjacent stays where the first checkout equals the second check-in. | Both are accepted because the half-open intervals do not overlap.                  |
| AT-04       | Check in a valid booking.                                                | Booking becomes CHECKED_IN and room becomes OCCUPIED atomically.                   |
| AT-05       | Record service usage and later change the catalogue price.               | Historical usage charge remains unchanged.                                         |
| AT-06       | Record three partial payments.                                           | Every payment is retained and the balance equals total minus successful payments.  |
| AT-07       | Attempt checkout with a positive balance.                                | Checkout is rejected and booking/room states remain unchanged.                     |
| AT-08       | Pay the remaining balance and check out.                                 | Booking becomes CHECKED_OUT, room becomes CLEANING and final documents are issued. |
| AT-09       | Generate all five mandatory reports.                                     | Totals match independent verification queries.                                     |
| AT-10       | Attempt SQL injection through login or guest search.                     | The input is treated as data and no unauthorized action occurs.                    |
| AT-11       | Run all migrations and seed data on a clean CI database.                 | Setup and automated tests complete successfully.                                   |
| AT-12       | Restore the latest backup to an isolated database.                       | Schema and verification queries succeed.                                           |

## 6.6 Migration and Initialization

Because the old desktop data format is not defined in the project brief, automatic legacy import is not mandatory. The team shall provide schema migration files and a deterministic seed script. If legacy data is later supplied, it shall be loaded into staging tables, validated, deduplicated and transformed through reviewed SQL before being inserted into production tables.

## 6.7 Localization, Legal and Policy Considerations

- The system shall use LKR and Asia/Colombo operational time by default.

- Tax, service charge, discount, cancellation and late-checkout percentages shall be configurable and approved by hotel management before production use.

- Guest data shall be collected only for legitimate reservation and hotel-operation purposes.

- The SRS does not claim that demonstration tax or retention settings satisfy current law; production values require authorized review.

- English is the required interface language for Version 1.0; the data model should allow future localization.

# Appendix A: Glossary

**Table 55 - Glossary**

| **Term**                     | **Definition**                                                                                        |
|------------------------------|-------------------------------------------------------------------------------------------------------|
| ACID                         | Atomicity, Consistency, Isolation and Durability properties of database transactions.                 |
| Active booking               | A BOOKED or CHECKED_IN reservation that participates in conflict detection.                           |
| Audit log                    | Append-only evidence of significant user, financial and configuration actions.                        |
| Booking                      | A reservation connecting a guest to a room for a check-in/check-out interval.                         |
| CI/CD                        | Continuous Integration and Continuous Delivery or Deployment.                                         |
| Database migration           | A version-controlled SQL change that advances the schema or controlled data state.                    |
| Exclusion constraint         | A PostgreSQL constraint capable of rejecting overlapping room/date ranges.                            |
| Foreign key                  | A constraint requiring a referenced record to exist, preserving referential integrity.                |
| HRGSMS                       | Hotel Reservation and Guest Services Management System.                                               |
| Invoice line                 | An individual room, service, tax, discount or adjustment amount belonging to an invoice.              |
| Normalization                | Decomposition of data structures to reduce redundancy and update, insert and delete anomalies.        |
| ORM                          | Object-Relational Mapping framework. ORM use is prohibited in this project.                           |
| Outstanding balance          | Invoice total minus successful payments.                                                              |
| Parameterized query          | SQL containing placeholders whose values are bound separately from SQL syntax.                        |
| Partial payment              | A successful payment smaller than the current outstanding balance.                                    |
| Rate snapshot                | The room rate agreed when a booking is created or formally modified.                                  |
| Raw SQL                      | SQL written and reviewed by the project team and executed directly through the database driver.       |
| Room block                   | A date range during which a room is not sellable for maintenance or another approved reason.          |
| Room-night                   | One room available or occupied for one night.                                                         |
| Service usage                | A chargeable service consumed during a checked-in stay, including quantity and historical unit price. |
| Soft deletion / deactivation | Preventing new use of a record while preserving historical relationships.                             |

# Appendix B: Analysis Models

The following analysis models are included in the main body near the requirements they explain: system environment, component architecture, use-case overview, level-0 data-flow diagram, reservation workflow, booking-state model, room-state model, check-in workflow, service-usage workflow, checkout workflow, billing model, core and supporting entity-relationship diagrams, booking transaction/concurrency flow, database-object map, reporting flow, deployment architecture, CI/CD pipeline, backup/recovery model and requirements-to-release traceability flow.

**Table 56 - Analysis Model Index**

| **Model**                                     | **Purpose**                                                           | **Location**                    |
|-----------------------------------------------|-----------------------------------------------------------------------|---------------------------------|
| System environment and component architecture | Defines actors, application components and database boundary.         | Section 2.1                     |
| Use-case overview                             | Summarizes roles and major services.                                  | Section 2.2                     |
| Level-0 DFD                                   | Shows external data flows and the operational database.               | Section 4                       |
| Reservation and state models                  | Explains booking creation and legal booking/room transitions.         | Sections 4.2 and 4.4            |
| Check-in, service and checkout workflows      | Explains critical transactional user flows.                           | Sections 4.5, 4.6 and 4.8       |
| Billing model                                 | Explains room, service, adjustment, payment and balance calculations. | Section 4.7                     |
| Core and supporting ER diagrams               | Defines principal entities and relationships.                         | Section 6.1.2                   |
| Transaction and database object models        | Explains ACID/concurrency and responsibility of SQL objects.          | Sections 6.1.1 and 6.1.7        |
| Reporting and backup models                   | Explains report data paths and recovery controls.                     | Sections 4.9, 6.1.10 and 6.1.12 |
| Deployment and CI/CD models                   | Explains deployed services and release flow.                          | Sections 6.2 and 6.3            |
| Traceability model                            | Links requirements to design, tests and release evidence.             | Section 6.4                     |

# Appendix C: To Be Determined List

**Table 57 - To Be Determined Items**

| **TBD ID** | **Item**                                                                              | **Owner / Closure Condition**                                     |
|------------|---------------------------------------------------------------------------------------|-------------------------------------------------------------------|
| TBD-01     | Final team member names and registration numbers.                                     | Team leader before formal submission.                             |
| TBD-02     | Final production hosting provider, domain and database service.                       | Deployment lead after environment approval.                       |
| TBD-03     | Approved tax, service charge, discount, cancellation and late-checkout policy values. | Stakeholder or lecturer approval before production configuration. |
| TBD-04     | Exact backup schedule, retention duration, recovery point and recovery time targets.  | Database lead before deployment.                                  |
| TBD-05     | Scope of direct guest self-service booking.                                           | Team and lecturer scope decision.                                 |
