WORKFORCE PLANNING LOOP
Product Vision Document


## 1.  Executive Summary
Workforce planning and labour budget governance is one of the largest, most consequential and least well-served problems in enterprise operations. Most organisations with more than 500 operational staff still run this process in Excel — fragmented, manual, unaudited, and disconnected from Finance.
This product is a commercial-grade workforce planning and budget governance platform that replaces that Excel-based process. It gives Operations and Finance teams a single, auditable, AI-assisted system for managing the full annual planning cycle: from the locked OPEX baseline through monthly reforecasting, actuals ingestion, variance analysis, waterfall reporting and AI-generated commentary.
The working prototype (V4.1) demonstrates the complete 12-stage planning loop, the deterministic calculation engine, the driver-based forecasting model, the forecast lock governance system, the cost decomposition framework and the embedded AI Analyst. The prototype is being handed to a development partner (Lovable) for production implementation.

## 2.  The Problem
### 2.1  What is currently broken
Large operations organisations — customer operations, content moderation, trust and safety, back-office, shared services — collectively manage billions of dollars of annual labour spend. The workforce planning process that governs this spend is almost universally broken in the same four ways.

#### Fragmented and manual
Annual plans are built in disconnected Excel files by different teams with different assumptions.
Monthly reforecasting runs happen in separate spreadsheets with no version control.
Actuals are posted in Finance systems but reconciled manually against plan data.
Variance analysis is produced in ad hoc reports with no audit trail.

#### No governance over the forecast
There is no "latest locked forecast" concept. The most recent version of a spreadsheet is the plan.
Historical forecast snapshots are not preserved. It is impossible to compare what was forecast in January against what was forecast in April.
Assumptions change mid-cycle with no record of who changed what, when, and why.
There is no controlled process for Finance to approve a reforecast before it becomes official.

#### Planning divorced from financial governance
Workforce planners manage FTE models. Finance manages cost models. They do not speak the same language.
The three critical cost views — cost to meet demand, committed supply cost, and cost to close the FTE gap — are rarely made explicit.
Budget variance analysis cannot be traced back to specific drivers because there is no driver register.
Waterfall reporting (Baseline → Forecast → Actuals) has to be built manually each cycle.

#### AI is being added on top of broken processes
Generic AI tools are being applied to broken planning data and producing unreliable outputs.
There is no separation between deterministic model outputs (which should be authoritative) and AI-generated commentary (which should be advisory).
AI tools that calculate FTE or cost numbers independently — without a transparent, auditable formula underneath — are not fit for Finance-grade planning.

### 2.2  The consequence
Operations and Finance leaders cannot answer the most basic governance questions: what is the valid current forecast, how did we get here from the baseline, why is actuals different from forecast, which driver is responsible, and what should we change for the remaining months of the year? The result is poor decisions, budget surprises, unplanned headcount costs, and service risk.
## 3.  Market Opportunity
### 3.1  Target market
The initial target is enterprise organisations with large operations workforces — customer operations, content moderation, trust and safety, back-office processing, shared services and BPO management — with annual labour spend above $10 million.


### 3.2  Why now
AI automation is changing demand forecasts materially. Organisations need a planning system that can model AI-driven workload reductions alongside traditional growth drivers with proper evidence gates.
Finance teams are increasingly demanding that workforce plans be governed the same way as financial plans — with baselines, version control, lock governance, variance analysis and audit trails.
Workforce planning as a profession is maturing. Senior WFP leaders expect tools that match the sophistication of their analytical practice.
Tools such as Lovable, Cursor and similar AI coding platforms can accelerate prototype-to-MVP development, but production implementation still requires strong backend, security, data and enterprise architecture discipline.

### 3.3  Competitive landscape
The market splits into three categories, none of which solves the core problem:
Anaplan, Workday Planning, Adaptive: enterprise FP&A platforms that can model workforce cost but require significant implementation effort and are not workflow-planner friendly.
WFM tools (NICE, Verint, Aspect, Calabrio): focused on scheduling and intraday, not annual planning and budget governance.
Excel + Power BI: the current universal default. Flexible but fragmented, unaudited and not governed.
Few tools are purpose-built to combine the monthly reforecast lock governance cycle, deterministic driver-based planning, three-view cost decomposition, actuals variance bridge and AI advisory in a single system for Operations and Finance teams together.

## 4.  Product Vision
### 4.1  One sentence
A workforce planning and budget governance platform that gives Operations and Finance one source of truth for the full annual cycle: from locked baseline through monthly reforecasts, actuals ingestion, variance analysis, waterfall reporting and AI-generated advisory.

### 4.2  The core insight
The product is built on a single structural insight that every experienced workforce planner and Finance partner recognises immediately, but few existing tools enforce consistently:
Every number in the plan should be traceable back to this spine. The baseline is immutable. The drivers are owned, evidenced and approved. The locked forecast is the valid current view. Actuals never overwrite the forecast. Variance is always explained by named drivers.

### 4.3  The three cost views
Most planning tools conflate three fundamentally different cost views. This product makes all three explicit and uses the right view for the right decision:

## 5.  Target Users
### 5.1  Primary personas

#### The Workforce Planner
Has 3–10+ years of operational planning experience. Builds monthly FTE, demand and productivity models. Currently spends 40–60% of their time managing data in Excel and reconciling versions with Finance. Wants a tool that respects their domain knowledge and gives them a professional-grade modelling environment.
#### The Finance Business Partner
Owns the labour OPEX budget for a business unit. Needs to understand what is driving variance between the budget baseline, the latest forecast and actuals. Currently gets a PowerPoint update once a month and cannot interrogate the underlying model. Wants a single version of the truth with full auditability.
#### The Operations Leader (COO / VP)
Accountable for service levels and cost efficiency across the operation. Needs to understand the trade-offs between funding demand, accepting supply risk and investing in efficiency programs. Currently relies on a weekly update deck. Wants scenario comparisons and a clear decision recommendation.
#### The Transformation / AI Program Manager
Responsible for AI deflection, automation and productivity programs. Needs to enter efficiency drivers into the forecast with phasing models, evidence gates and confidence ratings. Currently has no structured way to record and track the forecast impact of transformation programs.

## 6.  The Planning Architecture
### 6.1  The 12-stage planning loop
The prototype demonstrates the complete planning cycle as 12 sequential but interconnected stages. Each stage feeds the next. Every output is deterministic or clearly labelled as AI-advisory.


### 6.2  The deterministic calculation engine
The workforce-to-FTE formula is the core of the model. All FTE, cost and budget numbers are calculated deterministically. AI does not touch this layer.

Supply modelling uses a cohort ramp model. Each hire cohort is tracked separately. Attrition is applied to each cohort monthly. New hires move through a ramp curve to full productivity. This separates productive supply from closing headcount.
### 6.3  The driver layer
Every movement from the budget baseline to the latest forecast is explained by a named driver. Each driver has:
Category: growth, efficiency, cost change, supply change, or management adjustment
Phasing: straight-line, ramp-up, ramp-down, or one-off
Status: approved (feeds official forecast), proposed (scenarios only), or draft
Owner, confidence rating, start period, end period, and supporting commentary
Only approved drivers feed the official forecast. Proposed drivers are used in scenarios until a planner approves them. This is the governance gate between Finance and Operations.
### 6.4  Forecast lock governance
Every monthly reforecast is locked on a defined governance date. Locked snapshots are immutable. The latest locked snapshot is the valid current forecast. Historical locks are preserved for audit and accuracy tracking. Future unlocked months are editable. Actuals are stored separately and never overwrite forecast values.

## 7.  Core Product Capabilities
### 7.1  Annual Budget Baseline management
Create and lock the annual OPEX baseline.
Support seasonality weights for monthly budget phasing.
Produce an immutable snapshot with checksum. Corrections require a controlled admin workflow and audit event.
Baseline is the permanent reference for all reforecast variance calculations throughout the year.

### 7.2  Monthly reforecast cycle
Build the latest working forecast from Baseline + approved drivers.
Three cost views per month: demand cost, committed supply cost, cost to close the gap.
Lock the forecast on the governance date. Store as an immutable snapshot.
Set the latest locked forecast as the valid current forecast for all downstream reporting.
Compare any two forecast versions: prior lock vs current lock, baseline vs current lock, any two periods.

### 7.3  Actuals ingestion
Manual upload: CSV or Excel.
Integration framework: API connectors, SFTP, data warehouse for WFM, HR, Finance and queue systems.
Staged ingestion: actuals are staged, mapped, validated and then approved before posting.
Approved actuals are stored separately and never overwrite locked forecast values.

### 7.4  Variance analysis
Locked forecast vs actuals: volume, AHT, FTE, cost and budget variance.
Baseline vs latest forecast: approved driver impact.
Prior forecast vs latest forecast: month-on-month reforecast movement.
Waterfall bridge showing how the plan changed over time.

### 7.5  AI advisory
The AI Analyst explains variance, flags risks and recommends questions to ask.
It reads deterministic outputs only. It does not generate official numbers.
It can produce executive commentary, anomaly explanations and suggested next actions.
Every AI output is labelled as advisory and can be overridden by a human.

## 8.  MVP Scope
### 8.1  What the MVP must prove
The MVP must prove that the complete planning loop can operate in a controlled, governed SaaS workflow.
It must demonstrate:
Baseline creation and lock
Driver registration and approval
Forecast recalculation from approved drivers
Forecast lock and version history
Actuals upload and variance calculation
Waterfall reporting
AI commentary on deterministic outputs
Role-based governance and audit trail

### 8.2  What is not required in MVP
The MVP does not need full enterprise integration, SSO, billing, multi-currency support, every possible workforce model, or every WFM vendor connector. It does need credible architecture for all of these later.

## 9.  Commercial Positioning
### 9.1  Product category
This is not a WFM scheduling tool. It is not a generic FP&A platform. It is a workforce planning and labour budget governance platform.
The simplest positioning:
"The operating system for workforce planning, reforecasting and labour budget governance."

### 9.2  Buyer
Primary economic buyer: Finance, Operations, Workforce Planning, or COO office in large operations organisations.

### 9.3  Value proposition
Reduce manual Excel planning effort.
Improve budget accuracy and forecast governance.
Make workforce cost drivers transparent.
Create auditable links between demand, FTE, cost, actuals and variance.
Enable AI commentary without allowing AI to corrupt official numbers.

## 10.  Technical Principles
### 10.1  Architecture principles
Multi-tenant SaaS from day one.
Every business table scoped by organisation.
Role-based access control.
Immutable locked snapshots.
Append-only audit trail.
Deterministic calculation engine separate from AI commentary.
Server-side AI calls only.
No secrets in browser.

### 10.2  Data principles
Forecasts and actuals are separate objects.
Locked versions are immutable.
Drivers explain changes.
Every material action is auditable.
AI never becomes the system of record.

## 11.  Development Guidance
### 11.1  What to preserve from the prototype
The 12-stage loop.
The deterministic calculation model.
The driver register.
The forecast lock concept.
The three cost views.
The variance bridge.
The AI Analyst boundary.
The Finance + Operations governance model.

### 11.2  What to improve in production
Real backend database and authentication.
Secure role model.
Server-side calculations.
Proper API layer.
Scalable data model.
Test coverage.
Logging and error handling.
Tenant isolation.
Deployment pipeline.

## 12.  Final Product Principle
This product should feel like it was designed by someone who has actually owned workforce planning and budget governance in a large operation — not by someone who only understands dashboard software.
The quality bar is not a pretty prototype. The quality bar is whether a senior Workforce Planning leader, Finance Business Partner, or Operations VP would trust the system to govern a real labour budget.
