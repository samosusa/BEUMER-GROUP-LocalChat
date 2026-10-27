# Demo corpus question set

146 English questions over the 12 demo documents in `data/demo-inputs/`, generated alongside `demo_qa_pairs.json` (the file the benchmarks read).

Every question is tagged with a difficulty (easy / medium / hard), an answer type and the source document's format and size. `keywords` are phrases copied from the source passage: a retrieval benchmark counts a question as having its evidence when a selected passage contains them. `answerable: false` marks questions whose answer is not in the corpus - the correct behaviour is to say so.

| Difficulty | Count |
|---|---|
| easy | 38 |
| hard | 37 |
| medium | 71 |

| Type | Count |
|---|---|
| conditional | 16 |
| fact | 51 |
| list | 15 |
| multi-doc | 8 |
| numeric | 18 |
| procedure | 15 |
| reasoning | 11 |
| unanswerable | 12 |

## Crane Operations Manual (`md-long.md`)

| ID | Difficulty | Type | Question | Expected answer |
|---|---|---|---|---|
| md-long-01 | easy | numeric | Within what percentage of rated capacity does a crane lift need a second qualified person to confirm the load? | Lifts within 90 percent of rated capacity. |
| md-long-02 | easy | fact | Who directs the crane operator during a lift? | One designated signal person, using standard hand signals or a two-way radio. |
| md-long-03 | easy | numeric | How recently must rigging hardware have been inspected before it may be used? | Within the last 12 months, and it must be rated for the intended load. |
| md-long-04 | easy | fact | What happens to a sling that shows cuts, abrasion or crushed fibers? | It is removed from service on the spot. |
| md-long-05 | medium | procedure | What must the crane operator do if radio contact with the signal person is lost during a lift? | Hold the load in place until visual signal contact is reestablished. |
| md-long-06 | medium | fact | How large must the exclusion zone radius around a suspended load be? | At least the maximum boom length. |
| md-long-07 | medium | list | What does the crane operator check before any lift? | The hoist line for fraying, that the load chart matches the boom configuration, the upper and lower limit switches, and that outrigger pads are on stable, level ground. |
| md-long-08 | medium | conditional | When is a crane lift treated as a critical lift, and what does it require? | When the load weight is uncertain; it needs a written lift plan reviewed by the site safety officer beforehand. |
| md-long-09 | medium | fact | What happens to a crane that has a damaged hook latch? | It is a safety-critical defect, so the crane is tagged out of service immediately. |
| md-long-10 | medium | conditional | When must riggers attach a tag line to a load? | To any load that could rotate or swing once it clears the ground. |
| md-long-11 | medium | list | Which factors determine the choice of sling for a lift? | The load weight, the center of gravity and the angle of the lift - never estimated by eye. |
| md-long-12 | medium | fact | What must the crane operator and the signal person agree on before the lift begins? | That they use the same signal set, and an emergency stop signal that overrides all other instructions. |
| md-long-13 | medium | procedure | When can the exclusion zone barriers be removed after a lift? | Once the load is set down, the rigging is slack and the signal person confirms the area is clear. |
| md-long-14 | hard | reasoning | The boom length changed since the last lift. Can the operator reuse the capacity from that previous lift? | No. Rated capacity changes with boom angle, boom length and counterweight, so the load chart must be consulted for every new lift. |
| md-long-15 | hard | reasoning | A worker dropped a tool under a suspended load. May they walk under it to pick the tool up? | No. No one may walk under a suspended load for any reason, including to retrieve dropped tools. |
| md-long-16 | hard | reasoning | Why must outrigger pads be on stable, level ground before the boom is extended? | Because an unstable base is one of the leading causes of tip-over incidents on mobile cranes. |
| multi-08 | hard | multi-doc | Who has to stop work during a severe weather warning, and who directs a crane lift? | Forklift and crane operations stop immediately; a single designated signal person directs crane lifts. |
| none-01 | hard | unanswerable | What is the maximum lifting capacity of the crane in tonnes? | Not in the documentation - the assistant should say the information is not available. |

## Yard Traffic Rules (`md-sectioned.md`)

| ID | Difficulty | Type | Question | Expected answer |
|---|---|---|---|---|
| md-sectioned-01 | easy | numeric | What is the speed limit for vehicles in the yard? | 15 km/h. |
| md-sectioned-02 | easy | numeric | What is the yard speed limit close to a building entrance? | 5 km/h within 10 meters of any building entrance. |
| md-sectioned-03 | easy | fact | Who has right of way in the yard? | Trailers backing into a dock always have right of way. |
| md-sectioned-04 | easy | list | Who shares the yard? | Trailers, forklifts and pedestrians. |
| md-sectioned-05 | medium | procedure | What must a forklift do when a trailer is backing into a dock across its path? | Stop and wait until the trailer has finished backing in before crossing behind it. |
| md-sectioned-06 | medium | procedure | What should pedestrians do before crossing in front of a moving vehicle in the yard? | Make eye contact with the operator. |
| md-sectioned-07 | medium | conditional | Does the yard speed limit still apply when the yard is empty? | Yes, speed limits are enforced whether the yard is busy or empty. |
| md-sectioned-08 | medium | fact | What should drivers assume near the loading docks? | That they cannot be seen by trailer or crane operators. |
| md-sectioned-09 | hard | reasoning | A van is driving at 12 km/h about 8 meters from a building entrance. Is that allowed? | No. Within 10 meters of a building entrance the limit is 5 km/h. |

## Break Room Policy (`md-simple.md`)

| ID | Difficulty | Type | Question | Expected answer |
|---|---|---|---|---|
| md-simple-01 | easy | fact | When is food in the shared refrigerator thrown out? | Personal food left for more than a week is discarded on Friday afternoons. |
| md-simple-02 | easy | fact | Who may use the break rooms? | All staff, during scheduled breaks and the lunch period. |
| md-simple-03 | easy | fact | Who is responsible for cleaning the break room after use? | Employees clean up after themselves. |
| md-simple-04 | medium | numeric | How long can personal food stay in the break room fridge? | Up to a week; food left longer is discarded on Friday afternoons. |
| md-simple-05 | hard | reasoning | I left my lunch in the shared fridge on Monday of last week. What happens to it this Friday afternoon? | It has been there more than a week, so it will be discarded. |
| none-02 | hard | unanswerable | What is the Wi-Fi password in the break room? | Not in the documentation - the assistant should say the information is not available. |

## Site Emergency Response Plan (`pdf-long.pdf`)

| ID | Difficulty | Type | Question | Expected answer |
|---|---|---|---|---|
| pdf-long-01 | easy | fact | Where does the fire brigade assemble during a fire? | At the north gate, to brief arriving responders. |
| pdf-long-02 | easy | fact | Where do warehouse staff assemble during an evacuation? | In the north parking lot. |
| pdf-long-03 | easy | fact | Where do office staff assemble during an evacuation? | In the south courtyard. |
| pdf-long-04 | easy | numeric | Up to what volume may trained staff contain a chemical spill themselves? | Spills under 1 liter. |
| pdf-long-05 | easy | fact | Can elevators be used during a fire evacuation? | No, do not use elevators. |
| pdf-long-06 | medium | numeric | Within how many minutes must the evacuation headcount be reported to the site safety officer? | Within five minutes of evacuation. |
| pdf-long-07 | medium | fact | Where are the automated external defibrillators located? | Near the break room and the main warehouse entrance. |
| pdf-long-08 | medium | procedure | What should I do first in a medical emergency? | Call the site emergency line first, then begin first aid only if trained. |
| pdf-long-09 | medium | conditional | When should staff stop using a fire extinguisher and evacuate? | If the fire grows beyond the size of a trash can. |
| pdf-long-10 | medium | fact | Who acts as incident commander during an emergency? | The senior manager on site, until the fire department or emergency medical services take control. |
| pdf-long-11 | medium | procedure | How are visitors and contractors accounted for during an evacuation? | With the front desk sign-in log, which the receptionist brings to the assembly point. |
| pdf-long-12 | medium | fact | Where do personnel shelter during a severe weather warning? | In the designated shelter areas in the central corridor, away from exterior windows and large roof spans. |
| pdf-long-13 | medium | fact | What happens to forklift and crane operations when a severe weather warning is issued? | They must stop immediately. |
| pdf-long-14 | medium | fact | How often is the emergency response plan reviewed? | Annually and after any incident requiring a full site evacuation. |
| pdf-long-15 | medium | conditional | When may people re-enter the building after a fire? | Only after the fire department gives an explicit all-clear. |
| pdf-long-16 | medium | fact | What do new hires learn about emergencies on their first day? | A walkthrough of their nearest exit routes and assembly point. |
| pdf-long-17 | hard | conditional | Who becomes incident commander if the senior manager on site cannot be reached? | The shift supervisor with the longest tenure on site. |
| pdf-long-18 | hard | procedure | What must happen for a chemical spill of about three liters? | Full evacuation of the affected zone and notification of the site safety officer; increase ventilation where safe and hand the safety data sheet to responders. |
| pdf-long-19 | hard | procedure | What happens if someone is still unaccounted for after the headcount? | They are reported to the fire brigade leader immediately so responders can begin a targeted search. |
| multi-02 | medium | multi-doc | Where are spill kits located on site? | At each dock bay and in the chemical storage room, within 10 meters of the storage area. |
| multi-07 | hard | multi-doc | How is a safety data sheet used in chemical storage and during a chemical spill? | Every stored chemical must have a current safety data sheet on file, and in a spill the sheet is pulled and handed to responders. |
| none-04 | hard | unanswerable | What is the phone number of the site emergency line? | Not in the documentation - the assistant should say the information is not available. |
| none-08 | hard | unanswerable | What is the name of the current site safety officer? | Not in the documentation - the assistant should say the information is not available. |

## Loading Dock Procedures (`pdf-sectioned.pdf`)

| ID | Difficulty | Type | Question | Expected answer |
|---|---|---|---|---|
| pdf-sectioned-01 | easy | numeric | What are the loading dock's operating hours? | 06:00 to 22:00 on weekdays. |
| pdf-sectioned-02 | easy | fact | Who assigns trailers to dock bays? | The dock coordinator, based on the delivery schedule. |
| pdf-sectioned-03 | medium | list | What must be engaged before the dock plate is lowered? | Wheel chocks and a dock lock. |
| pdf-sectioned-04 | medium | fact | What colour does the dock light show before trailer securing is confirmed? | Red, then green once loading may begin. |
| pdf-sectioned-05 | medium | conditional | Can a driver pick their own dock bay? | No, not without the dock coordinator's approval. |
| pdf-sectioned-06 | medium | list | What must be cleared from the dock apron between trailers? | Pallets, stretch wrap and strapping debris. |
| pdf-sectioned-07 | medium | procedure | What must a trailer do before backing into a bay? | Check in with the dock coordinator. |
| pdf-sectioned-08 | hard | reasoning | A trailer arrives at 23:00 on a Wednesday. Can it be unloaded at the dock? | No. The loading dock only operates from 06:00 to 22:00 on weekdays. |
| none-12 | hard | unanswerable | How many dock bays does the loading dock have? | Not in the documentation - the assistant should say the information is not available. |

## Visitor Parking Policy (`pdf-simple.pdf`)

| ID | Difficulty | Type | Question | Expected answer |
|---|---|---|---|---|
| pdf-simple-01 | easy | fact | Where must visitors park? | Only in the marked visitor spaces near the main entrance. |
| pdf-simple-02 | easy | fact | Where are visitor parking passes issued? | At the front desk. |
| pdf-simple-03 | medium | list | Where are visitors not allowed to park? | Loading dock lanes, fire lanes and reserved employee spaces. |
| pdf-simple-04 | medium | fact | Where should a visitor display the parking pass? | On the dashboard, for the full duration of the visit. |
| pdf-simple-05 | hard | reasoning | The visitor spaces are full. Can a visitor use an empty reserved employee space? | No, parking in reserved employee spaces is not permitted for visitors. |
| multi-04 | medium | multi-doc | What does a visitor need to do on arrival, from parking to entering the production floor? | Park in a marked visitor space with the pass on the dashboard, then check in at the front security desk for a badge and stay with an employee escort. |
| none-03 | hard | unanswerable | How many parking spaces are reserved for visitors? | Not in the documentation - the assistant should say the information is not available. |

## Forklift Operations Manual (`txt-long.txt`)

| ID | Difficulty | Type | Question | Expected answer |
|---|---|---|---|---|
| txt-long-01 | easy | numeric | What is the forklift speed limit in warehouse aisles? | 8 km/h. |
| txt-long-02 | easy | numeric | How fast may a forklift drive near pedestrian crossings? | 5 km/h. |
| txt-long-03 | easy | numeric | How often must the internal forklift certification be renewed? | Every three years. |
| txt-long-04 | easy | numeric | How high may a load be carried while the forklift is travelling? | No higher than 15 cm off the ground, tilted back. |
| txt-long-05 | easy | fact | Who reviews the forklift inspection sheets, and how often? | The maintenance lead, weekly. |
| txt-long-06 | medium | list | What does the forklift pre-shift inspection checklist cover? | Tire condition, fork straightness, hydraulic leaks, horn, backup alarm, seatbelt condition and mast chain tension. |
| txt-long-07 | medium | numeric | How soon must a forklift near-miss be reported to the shift supervisor? | Within one hour, with a written report within 24 hours. |
| txt-long-08 | medium | numeric | How long must a forklift battery cool down after a shift before charging? | At least thirty minutes. |
| txt-long-09 | medium | list | What protective equipment must operators wear when connecting forklift charging cables? | Safety glasses and gloves. |
| txt-long-10 | medium | reasoning | Why are battery charging areas no-smoking zones? | Because of hydrogen off-gassing during charging. |
| txt-long-11 | medium | procedure | How must a forklift be left when it is unattended? | Forks fully lowered, parking brake engaged and key removed. |
| txt-long-12 | medium | conditional | When must a forklift operator sound the horn? | At every blind corner and intersection. |
| txt-long-13 | medium | fact | Are passengers allowed to ride on a forklift? | No riders other than the operator, including on the forks or the load. |
| txt-long-14 | medium | fact | Who has priority at marked pedestrian crossings in the warehouse? | Pedestrians; forklifts must come to a complete stop. |
| txt-long-15 | medium | list | Which battery conditions mean a forklift battery must be taken out of service? | Swelling, cracking or excessive corrosion on the terminals. |
| txt-long-16 | medium | fact | Are high-visibility vests required on the warehouse floor? | Yes, mandatory for all pedestrians. |
| txt-long-17 | hard | conditional | What happens to an operator who skips the pre-shift inspection twice within 90 days? | They must repeat the internal certification course. |
| txt-long-18 | hard | procedure | After a forklift tip-over, what has to happen before the operator may drive again? | Report within one hour and in writing within 24 hours; maintenance inspects the forklift before it returns to service; the operator completes refresher training. |
| txt-long-19 | hard | conditional | What can repeated incidents by the same operator within a year lead to? | A formal review by the site safety committee, which may lead to additional training, restricted duties or suspension of forklift privileges. |
| multi-01 | medium | multi-doc | How does the forklift speed limit in warehouse aisles compare with the vehicle speed limit in the yard? | 8 km/h in warehouse aisles versus 15 km/h in the yard. |
| multi-03 | hard | multi-doc | Apart from the daily inspection, how often is a forklift serviced, and how often must its operator renew certification? | A 250-hour service; the operator certification is renewed every three years. |
| multi-06 | hard | multi-doc | What do the crane and forklift manuals both require when a safety-critical defect is found? | The equipment is tagged out of service immediately. |
| none-05 | hard | unanswerable | Which brand of forklift does the warehouse use? | Not in the documentation - the assistant should say the information is not available. |

## Warehouse Racking Safety (`txt-sectioned.txt`)

| ID | Difficulty | Type | Question | Expected answer |
|---|---|---|---|---|
| txt-sectioned-01 | easy | numeric | What is the maximum load per pallet racking bay? | 2,200 kg evenly distributed across the pallet footprint. |
| txt-sectioned-02 | easy | fact | How often does the warehouse supervisor inspect racking? | Monthly. |
| txt-sectioned-03 | medium | fact | Who performs the annual racking inspection? | A certified racking inspector. |
| txt-sectioned-04 | medium | procedure | What should I do if I find a bent beam in a racking bay? | Report it immediately; the bay is taken out of service with red tape until repaired. |
| txt-sectioned-05 | medium | fact | Where are racking load limit placards mounted? | On the end frame of every aisle. |
| txt-sectioned-06 | medium | fact | Who may load or reconfigure racking bays? | Only trained personnel. |
| txt-sectioned-07 | medium | fact | Where are racking inspection dates recorded? | In the facility maintenance system. |
| txt-sectioned-08 | hard | reasoning | Can I put a 2,500 kg load in a single racking bay? | No, it exceeds the 2,200 kg bay rating. |
| multi-05 | hard | multi-doc | Which is inspected more often: warehouse racking or conveyor belts? | Conveyor belts (visually inspected daily) - racking is inspected monthly by the supervisor and annually by a certified inspector. |
| none-07 | hard | unanswerable | What is the maximum height of the pallet racking? | Not in the documentation - the assistant should say the information is not available. |

## Visitor Badge Policy (`txt-simple.txt`)

| ID | Difficulty | Type | Question | Expected answer |
|---|---|---|---|---|
| txt-simple-01 | easy | fact | Where do visitors get a visitor badge? | At the front security desk. |
| txt-simple-02 | easy | fact | Can visitors walk the production floor alone? | No, they need an employee escort. |
| txt-simple-03 | easy | fact | Must a visitor badge be visible? | Yes, at all times. |
| txt-simple-04 | medium | procedure | What happens to the visitor badge at the end of a visit? | It is returned at checkout. |
| txt-simple-05 | medium | conditional | Can two visitors share one badge? | No, badge sharing between visitors is prohibited. |
| none-10 | hard | unanswerable | How much does it cost to replace a lost visitor badge? | Not in the documentation - the assistant should say the information is not available. |

## Preventive Maintenance Program (`word-long.docx`)

| ID | Difficulty | Type | Question | Expected answer |
|---|---|---|---|---|
| word-long-01 | easy | fact | How often are conveyor belts visually inspected? | Daily, by the shift operator. |
| word-long-02 | easy | fact | How often is conveyor belt tension checked? | Weekly, using the tension gauge at the designated test point. |
| word-long-03 | easy | fact | How often are HVAC air handling units filtered? | Monthly. |
| word-long-04 | easy | numeric | How long are maintenance records kept? | At least five years. |
| word-long-05 | medium | fact | How often are conveyor idler rollers inspected? | Monthly, for bearing noise and shell wear. |
| word-long-06 | medium | list | What does the quarterly conveyor drive train inspection include, and who does it? | Motor bearings and gearbox oil level, by the maintenance team. |
| word-long-07 | medium | list | What does a forklift's 250-hour service cover? | Hydraulic fluid, brake adjustment and mast chain lubrication, plus tire tread measurement. |
| word-long-08 | medium | numeric | How often are electric forklift batteries load-tested? | Every six months. |
| word-long-09 | medium | fact | When are HVAC refrigerant levels and coil condition checked? | Twice a year, ahead of the summer and winter seasons. |
| word-long-10 | medium | fact | How often do maintenance technicians need refresher training? | Annually. |
| word-long-11 | medium | fact | When are the conveyor emergency stop pull-cords tested? | At the start of each shift. |
| word-long-12 | medium | list | What information is logged for each maintenance activity? | Technician name, date, findings and parts used. |
| word-long-13 | medium | fact | Who performs the annual electrical inspection of rooftop HVAC units? | A licensed HVAC contractor under the site's service agreement. |
| word-long-14 | medium | list | What does the maintenance technician onboarding cover? | Lockout/tagout, confined space entry and the equipment-specific checklists. |
| word-long-15 | medium | fact | What is the goal of the preventive maintenance program? | To catch equipment wear before it causes an unplanned production stoppage or a safety incident. |
| word-long-16 | hard | conditional | When does equipment get a root-cause review instead of another routine repair? | When it has three or more repeat findings within a twelve-month period. |
| word-long-17 | hard | conditional | A technician is coming back after four months away. What applies to them? | More than 90 days away: they are paired with a mentor for their first two weeks back before working solo. |
| word-long-18 | hard | procedure | What happens to deferred maintenance items that are older than two weeks? | The maintenance manager escalates them to the plant manager for prioritization. |
| word-long-19 | hard | conditional | What happens to a forklift whose tires are below the minimum tread depth? | It is scheduled for replacement before its next shift. |
| none-11 | hard | unanswerable | What is the annual maintenance budget in euros? | Not in the documentation - the assistant should say the information is not available. |

## Chemical Storage Guidelines (`word-sectioned.docx`)

| ID | Difficulty | Type | Question | Expected answer |
|---|---|---|---|---|
| word-sectioned-01 | easy | numeric | How far from the chemical storage area must spill kits be? | Within 10 meters. |
| word-sectioned-02 | easy | fact | How often are chemical spill kits checked? | Monthly, for completeness. |
| word-sectioned-03 | medium | fact | Where must flammable liquids be stored? | In an approved flammables cabinet away from ignition sources. |
| word-sectioned-04 | medium | list | What must be on every chemical container label? | The chemical name, hazard pictograms and the date it was opened. |
| word-sectioned-05 | medium | conditional | How are unlabeled chemical containers treated? | As unknown hazardous waste. |
| word-sectioned-06 | medium | conditional | Can oxidizers be stored next to flammable materials? | No, oxidizers are stored separately from flammable and combustible materials. |
| word-sectioned-07 | medium | fact | What is required for every chemical stored on site? | It must be listed in the chemical inventory system with a current safety data sheet. |
| word-sectioned-08 | hard | reasoning | A solvent bottle is labeled only with its name. Is that enough? | No, the label also needs hazard pictograms and the date it was opened. |

## Personal Protective Equipment Policy (`word-simple.docx`)

| ID | Difficulty | Type | Question | Expected answer |
|---|---|---|---|---|
| word-simple-01 | easy | list | What protective equipment is required on the production floor at all times? | Safety glasses and steel-toed boots. |
| word-simple-02 | easy | fact | Where is hearing protection required? | In any area marked with a high-noise placard. |
| word-simple-03 | medium | procedure | How can employees get prescription safety glasses? | Request them through the safety office. |
| word-simple-04 | medium | fact | Do prescription safety glasses cost the employee anything? | No, they are provided at no cost. |
| word-simple-05 | hard | reasoning | I'm in an area with no high-noise placard. Do I need hearing protection there? | Not under the policy - it is required only where a high-noise placard is posted; safety glasses and steel-toed boots still apply. |
| none-06 | hard | unanswerable | How many vacation days do employees get per year? | Not in the documentation - the assistant should say the information is not available. |
| none-09 | hard | unanswerable | At what decibel level is hearing protection required? | Not in the documentation - the assistant should say the information is not available. |
