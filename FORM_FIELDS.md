# Form Fields & Data Dictionary

This document maps all form questions, screens, options, and data keys used in the **MedSociety / Border Health** intake and research surveys (`/borderhealth` and `/research`), and details how they are stored in the database (`public.bh_responses`) and synced to GoHighLevel (GHL).

---

## 1. Database Storage Overview (`public.bh_responses`)

When a user completes a form, a single row is inserted into **`public.bh_responses`** in Supabase.

### 1.1 Direct Columns on `bh_responses`

| Column | Type | Description |
|---|---|---|
| `id` | `bigint` | Primary auto-incrementing key. |
| `created_at` | `timestamptz` | Submission timestamp. |
| `submission_key` | `uuid` | Client-generated unique ID (used for deduplication & provider onboarding). |
| `form_slug` | `text` | `'borderhealth'` or `'research'` (Mike Loya Center / UTEP / NSF study). |
| `segment` | `text` | `'employer'`, `'employee'`, or `'provider'`. |
| `lang` | `text` | `'en'` or `'es'`. |
| `session` | `text` | `'live'` or `'test'` (`?session=test` queries are excluded from analytics). |
| `ref` | `text` | Source tracking parameter (`?by=<name>` or `?ref=<name>`, defaults to `'link'`). |
| `client_id` | `text` | Stable client device ID persisted in `localStorage.bh_cid`. |
| `industry` | `varchar(80)` | Extracted primary industry string. |
| `city` | `varchar(80)` | Extracted primary city string. |
| `contact_name` | `varchar(120)` | Contact person's name. |
| `contact_org` | `varchar(160)` | Company, clinic, or organization name. |
| `contact_email` | `varchar(160)` | Email address. |
| `contact_phone` | `varchar(40)` | Contact phone number. |
| `follow_up` | `boolean` | `true` if respondent opted into follow-up (`'yes'` or `'info_first'`), `false` if `'no'`. |
| `duration_s` | `integer` | Duration in seconds spent completing the form. |
| `ua` | `varchar(300)` | User-agent string. |
| `user_id` | `uuid` | Authenticated Supabase user ID (if claimed/registered). |
| `provider_id` | `uuid` | Linked directory provider ID (for clinic onboarding). |
| `claim_id` | `uuid` | Linked provider claim ID (for clinic onboarding). |
| `outcome` | `text` | Onboarding outcome: `'claimed'`, `'claim_pending'`, or `'listing_pending'`. |
| **`answers`** | **`jsonb`** | **Complete dictionary of form questions and answers (see below).** |

---

### 1.2 `answers` JSON Structure

For every question answered, `answers` stores:
* **`answers[<question_id>]`**: The English human-readable label (or `"other: <custom text>"`).
* **`answers[<question_id> + '_key']`**: The internal machine key (e.g. `'manufacturing'`, `'cost'`).
* For multi-select: an array of labels and an array of keys.
* For "Which matters most" (`top`): `answers[<question_id> + '_top']` and `answers[<question_id> + '_top_key']`.

**System & metadata keys inside `answers`:**
* `form_version`: Always `'v2'`.
* `contact_whatsapp`: WhatsApp phone number (if provided and different from main phone).
* `follow_up_key`: Exact follow-up choice (`'yes'`, `'info_first'`, `'no'`).
* `utm`: Object containing URL UTM params (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`).
* `variant`: `'research'` or `'medsociety'`.

---

## 2. Common Reusable Option Sets

### Industry (`INDUSTRY`)
Used in Employer and Employee forms:
* `manufacturing`: *Manufacturing / maquila* (`Manufactura / maquila`)
* `healthcare`: *Healthcare* (`Salud`)
* `retail`: *Retail* (`Comercio`)
* `logistics`: *Logistics and transport* (`Logística y transporte`)
* `construction`: *Construction* (`Construcción`)
* `professional`: *Professional services* (`Servicios profesionales`)
* `hospitality`: *Restaurants and hospitality* (`Restaurantes y hotelería`)
* `education`: *Education* (`Educación`)
* `government`: *Government* (`Gobierno`)
* `utilities`: *Utilities (power, water, gas)* (`Servicios públicos (luz, agua, gas)`)
* `tech`: *Technology* (`Tecnología`)
* `agriculture`: *Agriculture* (`Agricultura`)
* `not_working`: *I do not currently work* (`No trabajo actualmente`) *(Employee only)*
* `other`: *Custom text entered in `<question_id>_other`*

### Place (`PLACE`)
* `juarez`: *Ciudad Juárez*
* `elpaso`: *El Paso*
* `both`: *Both sides* (`Ambos lados`)
* `not_working`: *I do not currently work* (`No trabajo actualmente`) *(Employee only)*
* `other`: *Custom text*

### Recency (`RECENCY`)
* `6m`: *Less than 6 months ago* (`Hace menos de 6 meses`)
* `12m`: *6 to 12 months ago* (`Hace 6 a 12 meses`)
* `2y`: *1 to 2 years ago* (`Hace 1 a 2 años`)
* `2y_plus`: *More than 2 years ago* (`Hace más de 2 años`)
* `dont_remember`: *I do not remember* (`No recuerdo`)

### Follow-up (`FOLLOW_OPTS`)
* `yes`: *Yes, a short conversation (15 minutes)* (`Sí, acepto una conversación breve (15 minutos)`)
* `info_first`: *Yes, but send me information first* (`Sí, pero prefiero recibir información primero`)
* `no`: *Not right now* (`No por ahora`)

---

## 3. Employer Form (`segment = 'employer'`)

### Screen 1: `org` (Your organization / Su empresa)

| Field ID | Type | Required | Question (EN / ES) | Options / Keys |
|---|---|---|---|---|
| `industry` | `single` | Yes | What industry is your organization in? / ¿En qué industria está su empresa? | `INDUSTRY` list + `other` |
| `size` | `single` | Yes | How many people work there? / ¿Cuántas personas trabajan ahí? | `1_10` (1 to 10)<br>`11_50` (11 to 50)<br>`51_250` (51 to 250)<br>`251_1000` (251 to 1,000)<br>`1000_plus` (More than 1,000) |
| `where` | `single` | Yes | Where are most of your employees based? / ¿Dónde está la mayoría de su personal? | `juarez`, `elpaso`, `both`, `other` |
| `role` | `single` | Yes | What is your role? / ¿Cuál es su rol? | `owner` (Owner or partner)<br>`hr` (HR)<br>`manager` (Manager or director)<br>`finance` (Finance or admin)<br>`other` |

### Screen 2: `coverage` (Health coverage today / Cobertura de salud hoy)

| Field ID | Type | Required | Question (EN / ES) | Options / Keys |
|---|---|---|---|---|
| `coverage` | `multi` | Yes | What health coverage do your employees have? / ¿Qué cobertura de salud tiene su personal? | `public_only` (Public only: IMSS, ISSSTE)<br>`private_employer` (Private insurance the company pays for)<br>`us_plan` (A US-based insurance plan)<br>`direct_docs` (Direct arrangement with doctors/clinics)<br>`none` (Nothing beyond legal requirement - exclusive)<br>`unsure` (Not sure - exclusive)<br>`private` (Prefer not to say - exclusive)<br>`other` |
| `insurers` | `text` | No | Which insurer or plan? / ¿Con qué aseguradora o plan? | Freeform text (e.g., GNP, AXA, Blue Cross) |
| `crossing` | `single` | Yes | Do your employees cross the border for care? / ¿Su personal cruza la frontera para atenderse? | `often` (Often)<br>`sometimes` (Sometimes)<br>`rarely` (Rarely)<br>`unsure` (Not sure) |

### Screen 3: `practice` (When someone needs care / Cuando alguien necesita atención)

| Field ID | Type | Required | Question (EN / ES) | Options / Keys |
|---|---|---|---|---|
| `help_how` | `multi` | Yes | When an employee needs medical care, how does your company help them today? / Cuando un empleado necesita atención médica, ¿cómo le ayuda hoy su empresa? | `insurance` (Points them to the insurance)<br>`onsite` (On-site doctor or nurse)<br>`refer` (Recommends doctors or clinics)<br>`time_off` (Gives time off for appointment)<br>`reimburse` (Reimburses or advances cost)<br>`own` (Employee handles it on their own - exclusive)<br>`unsure` (Not sure - exclusive)<br>`other` |
| `difficulties` | `multi` (max 3) | Yes | What is the hardest part of that process? / ¿Qué es lo más difícil de ese proceso? | `cost` (Cost)<br>`availability` (Provider availability)<br>`paperwork` (Paperwork)<br>`language` (Language barriers)<br>`coverage_limits` (Limited coverage)<br>`info` (Lack of information)<br>`absence` (Time away from work)<br>`none` (None - exclusive)<br>`unsure` (Not sure - exclusive)<br>`other` |
| `difficulties_top` | `top` | Conditional (if >=2 chosen) | Of those, which one matters most? / De esas, ¿cuál es la más importante? | Selected options from `difficulties` |
| `change` | `textarea` (max 600) | No | If you could change one thing about how your team gets healthcare, what would it be? / Si pudiera cambiar una cosa de cómo su equipo recibe atención médica, ¿cuál sería? | Freeform text |

### Screen 4: `contact` (Follow up / Seguimiento)
* Full contact screen: Name (`contact_name`), Organization (`contact_org`), Email (`contact_email`), Phone (`contact_phone`), WhatsApp (`contact_whatsapp`), and Follow-up choice (`follow_up_key`).

---

## 4. Employee Form (`segment = 'employee'`)

### Screen 1: `you` (About you / Sobre usted)

| Field ID | Type | Required | Question (EN / ES) | Options / Keys |
|---|---|---|---|---|
| `industry` | `single` | Yes | What industry do you work in? / ¿En qué industria trabaja? | `INDUSTRY` list + `not_working` + `other` |
| `work_where` | `single` | Yes | Where do you work? / ¿Dónde trabaja? | `juarez`, `elpaso`, `both`, `not_working`, `other` |
| `live_where` | `single` | Yes | Where do you live? / ¿Dónde vive? | `juarez`, `elpaso`, `other` |

### Screen 2: `coverage` (Your coverage / Su cobertura)

| Field ID | Type | Required | Question (EN / ES) | Options / Keys |
|---|---|---|---|---|
| `coverage` | `multi` | Yes | What health coverage do you have today? / ¿Qué cobertura de salud tiene hoy? | `public` (IMSS, ISSSTE, public)<br>`employer_private` (Private via job)<br>`self_private` (Private paid self)<br>`us_insurance` (US insurance)<br>`medicaid_medicare` (Medicaid/Medicare)<br>`none` (None - exclusive)<br>`unsure` (Not sure - exclusive) |
| `tier` | `single` | No | If your job offers plans, which did you choose? / Si su trabajo ofrece planes, ¿cuál eligió? | `cheapest` (The cheapest)<br>`middle` (The middle one)<br>`highest` (The most complete)<br>`no_choice` (There was no choice)<br>`na` (Not applicable) |
| `deduction` | `single` | Conditional (`work_where = juarez`) | Roughly, how much comes out of your pay each month for health coverage? / Aproximadamente, ¿cuánto le descuentan al mes por la cobertura de salud? | `none` (Nothing)<br>`under500` (Under 500 pesos)<br>`500_1500` (500 to 1,500 pesos)<br>`1500_3000` (1,500 to 3,000 pesos)<br>`over3000` (Over 3,000 pesos)<br>`unsure` (Not sure)<br>`private` (Prefer not to say) |
| `deduction_usd` | `single` | Conditional (`work_where in ['elpaso', 'both', 'other']`) | Roughly, how much comes out of your pay each month for health coverage? / Aproximadamente, ¿cuánto le descuentan al mes por la cobertura de salud? | `none` (Nothing)<br>`under25` (Under $25)<br>`25_80` ($25 to $80)<br>`80_160` ($80 to $160)<br>`160_400` ($160 to $400)<br>`over400` (Over $400)<br>`unsure` (Not sure)<br>`private` (Prefer not to say) |

### Screen 3: `care` (The last time you needed care / La última vez que necesitó atención)

| Field ID | Type | Required | Question (EN / ES) | Options / Keys |
|---|---|---|---|---|
| `last_doctor` | `single` | Yes | When did you last see a doctor (not counting emergencies)? / ¿Cuándo fue su última consulta con un médico? | `RECENCY` list |
| `last_dentist` | `single` | Yes | And your last dental visit? / ¿Y su última visita al dentista? | `RECENCY` list |
| `last_what` | `single` | Yes | The last time you needed medical care, what did you do to get it? / La última vez que necesitó atención médica, ¿qué hizo para recibirla? | `own_doctor` (Went to usual doctor)<br>`public` (Went to IMSS / public clinic)<br>`pharmacy` (Went to pharmacy clinic)<br>`urgent` (Went to urgent care or ER)<br>`crossed` (Crossed the border for care)<br>`virtual` (Had a virtual visit)<br>`waited` (Waited or did not go)<br>`dont_remember` (I do not remember)<br>`other` |
| `last_hardest` | `multi` (max 3) | Yes | What was the hardest part of that process? / ¿Qué fue lo más difícil de ese proceso? | `finding` (Finding a provider)<br>`coverage` (Confirming coverage)<br>`scheduling` (Getting an appointment)<br>`paying` (Paying)<br>`transport` (Transportation or crossing)<br>`communication` (Communicating with provider)<br>`paperwork` (Paperwork)<br>`time_off` (Getting time off work)<br>`nothing` (Nothing, it was easy - exclusive)<br>`dont_remember` (I do not remember - exclusive)<br>`other` |
| `last_hardest_top` | `top` | Conditional (if >=2 chosen) | Of those, which one matters most? / De esas, ¿cuál es la más importante? | Selected options from `last_hardest` |
| `workaround` | `multi` | Conditional (hidden if `last_hardest` was `nothing` or `dont_remember`) | How did you deal with it? / ¿Cómo lo resolvió? | `crossed` (Crossed the border)<br>`out_of_pocket` (Paid out of pocket)<br>`asked_help` (Asked someone for help)<br>`delayed` (Put off the care)<br>`went_without` (Went without care)<br>`unsure` (Not sure - exclusive)<br>`other` |
| `crossed` | `single` | Yes | Have you crossed the border for medical or dental care? / ¿Ha cruzado la frontera para atención médica o dental? | `regularly` (Yes, regularly)<br>`few_times` (A few times)<br>`never` (Never) |
| `records` | `multi` | Conditional (`crossed in ['regularly', 'few_times']`) | When you get care in another country, what problems do you have accessing, sharing, or following up on your medical records? / Cuando recibe atención médica en otro país, ¿qué dificultades tiene para acceder, compartir o dar seguimiento a sus expedientes médicos? | `no_history` (Provider does not have prior records)<br>`carry` (Have to bring/send them myself)<br>`language` (In another language)<br>`results` (Test results hard to transfer)<br>`repeat` (Tests/procedures repeated)<br>`no_problem` (No problems - exclusive)<br>`other` |
| `change` | `textarea` (max 600) | No | If one thing about getting healthcare were easier, what would it be? / Si una sola cosa de conseguir atención médica fuera más fácil, ¿cuál sería? | Freeform text |

### Screen 4: `contact` (Follow up / Seguimiento)
* Light contact screen: Follow-up question (`follow_up_key`), contact details optional unless follow-up is requested.

---

## 5. Provider Form (`segment = 'provider'`)

### Screen 1: `practice` (Your practice / Su consultorio)

| Field ID | Type | Required | Question (EN / ES) | Options / Keys |
|---|---|---|---|---|
| `practice_type` | `single` | Yes | What kind of practice is it? / ¿Qué tipo de práctica tiene? | `gp` (General practice)<br>`specialist` (Specialist)<br>`dental` (Dental)<br>`vision` (Optometry or ophthalmology)<br>`imaging_lab` (Lab or imaging)<br>`hospital` (Hospital)<br>`pharmacy` (Pharmacy)<br>`other` |
| `specialty` | `text` | Conditional (`practice_type = specialist`) | Which specialty? / ¿Cuál especialidad? | Freeform text (e.g. orthopedics, cardiology) |
| `city` | `single` | Yes | Where is your practice mainly located? / ¿Dónde está ubicado principalmente su consultorio? | `juarez` (Ciudad Juárez)<br>`elpaso` (El Paso)<br>`tijuana` (Tijuana)<br>`sandiego` (San Diego)<br>`chihuahua_city` (Ciudad de Chihuahua)<br>`other` |
| `size` | `single` | Yes | How many doctors or clinicians see patients there? / ¿Cuántos médicos o profesionales atienden ahí? | `solo` (Just me)<br>`2_5` (2 to 5)<br>`6_20` (6 to 20)<br>`20_plus` (More than 20) |
| `us_patients` | `single` | Yes | Roughly what share of your patients come from across the border? / Aproximadamente, ¿qué parte de sus pacientes viene del otro lado de la frontera? | `none` (None)<br>`under10` (Under 10%)<br>`10_25` (10% to 25%)<br>`25_50` (25% to 50%)<br>`over50` (Over 50%)<br>`unsure` (Not sure) |

### Screen 2: `find` (How patients find and book you / Cómo lo encuentran y agendan)

| Field ID | Type | Required | Question (EN / ES) | Options / Keys |
|---|---|---|---|---|
| `presence` | `multi` | Yes | Where can patients find you online? / ¿Dónde lo pueden encontrar los pacientes en línea? | `website` (Website)<br>`google` (Google Business profile)<br>`social` (Facebook or Instagram)<br>`whatsapp_business` (WhatsApp Business)<br>`directory` (Medical directory: Doctoralia, etc.)<br>`none` (Nowhere - exclusive) |
| `website` | `text` (URL) | No | Your website or profile / Su sitio web o perfil | Website URL |
| `booking` | `multi` | Yes | How do patients book? / ¿Cómo agendan los pacientes? | `phone` (By phone)<br>`whatsapp` (By WhatsApp)<br>`walkin` (Walk in)<br>`online` (Online booking)<br>`hospital` (Through the hospital)<br>`referral` (By referral)<br>`other` |
| `english` | `single` | Yes | Can patients be seen in English? / ¿Pueden atender a pacientes en inglés? | `fluent` (Yes, without a problem)<br>`some` (Somewhat)<br>`none` (No) |
| `virtual` | `single` | Yes | Do you offer virtual visits? / ¿Ofrecen consultas virtuales? | `yes` (Yes)<br>`no` (No)<br>`considering` (Considering it) |

### Screen 3: `ops` (From booking to payment / De la cita al pago)

| Field ID | Type | Required | Question (EN / ES) | Options / Keys |
|---|---|---|---|---|
| `payments` | `multi` | Yes | How can patients pay? / ¿Cómo pueden pagar los pacientes? | `cash` (Cash)<br>`card` (Card)<br>`transfer` (Bank transfer)<br>`mx_insurance` (Mexican insurance)<br>`us_insurance` (US insurance)<br>`plans` (Payment plans)<br>`online` (Online payment)<br>`other` |
| `insurers` | `text` | No | Which insurers do you work with? / ¿Con qué aseguradoras trabaja? | Freeform text (e.g. GNP, AXA) |
| `imaging` | `multi` | No | What can you do on site? / ¿Qué estudios hacen en sitio? | `xray` (X-ray)<br>`ultrasound` (Ultrasound)<br>`ct_mri` (CT or MRI)<br>`lab` (Lab work)<br>`none` (Nothing, we refer out - exclusive) |
| `process` | `textarea` (max 600) | No | When a patient needs care, how does the process run today, from booking to payment? / Cuando un paciente necesita atención, ¿cómo se coordina hoy el proceso desde la cita hasta el pago? | Freeform text |
| `process_hardest` | `single` | Yes | Which part of that process is the hardest? / ¿En qué parte del proceso se presenta la mayor dificultad? | `booking` (Booking appointment)<br>`no_shows` (Getting patient to show up)<br>`coverage` (Checking insurance)<br>`records` (Getting prior records)<br>`billing` (Getting paid)<br>`follow_up` (Follow-up after visit)<br>`none` (None in particular)<br>`other` |
| `bottlenecks` | `multi` (max 3) | Yes | Which problems affect your practice most today? / ¿Qué problemas afectan más a su consultorio hoy? | `no_shows` (No-shows)<br>`billing` (Billing and collections)<br>`new_patients` (Getting new patients)<br>`admin` (Admin and paperwork)<br>`claims` (Insurance claims)<br>`records` (Medical records)<br>`staffing` (Staffing)<br>`none` (Nothing in particular - exclusive)<br>`other` |
| `bottlenecks_top` | `top` | Conditional (if >=2 chosen) | Of those, which one matters most? / De esas, ¿cuál es la más importante? | Selected options from `bottlenecks` |
| `records` | `multi` | Conditional (`us_patients` != `'none'`) | When you treat patients from across the border, what problems do you have receiving, reading, or sharing their medical records? / Cuando atiende a pacientes que vienen del otro lado de la frontera, ¿qué dificultades tiene para recibir, interpretar o compartir sus expedientes médicos? | `no_history` (No prior records)<br>`language` (In another language)<br>`format` (Paper/hard-to-use formats)<br>`results` (Test results hard to receive)<br>`repeat` (Have to repeat tests)<br>`send_back` (Hard to send info back)<br>`no_problem` (No problems - exclusive)<br>`other` |
| `referrals` | `single` | Yes | Are you open to receiving patients referred by a network of clinics? / ¿Está abierto a recibir pacientes referidos por una red de clínicas? | `yes` (Yes)<br>`depends` (Depends on terms)<br>`no` (No) |

### Screen 4: `contact` (Follow up / Seguimiento)
* Full contact screen: Name (`contact_name`), Clinic name (`contact_org`), Email (`contact_email`), Phone (`contact_phone`), WhatsApp (`contact_whatsapp`), and Follow-up choice (`follow_up_key`).

---

## 6. How GHL (GoHighLevel) Connects to This Data

The connection to GHL is managed in [`api/borderhealth-lead.ts`](api/borderhealth-lead.ts). After a successful `bh_responses` insert, the client POSTs contact fields plus the same `answers` object and `submission_key` (best-effort).

**Sync rules**

- Enumerated answers: send machine keys (`answers.<id>_key`), not English labels.
- Multi-select: send the key array (e.g. `["cost","availability"]`).
- Free text: send as entered (`answers.specialty`, `answers.insurers`, `answers.website`, `answers.change`).
- Empty / missing values are omitted.
- Each contact gets **universal** fields plus **one** segment block (`employer` | `employee` | `provider`).
- Upsert uses GHL custom field **`id`** (below). `fieldKey` is the stable GHL key for reference.

### 6.1 Native GHL contact fields

| Supabase / payload | GHL native property |
|---|---|
| `bh_responses.contact_name` | `name` / `firstName` / `lastName` |
| `bh_responses.contact_email` | `email` |
| `bh_responses.contact_phone` | `phone` |
| `bh_responses.contact_org` | `companyName` |

### 6.2 Universal custom fields (all segments)

| Supabase source | GHL field name | `fieldKey` | GHL field `id` | Type |
|---|---|---|---|---|
| `bh_responses.segment` | Border Health - Segment | `contact.border_health__segment` | `TFCiyaz63Z64EVhFdw9N` | SINGLE_OPTIONS |
| `bh_responses.lang` | Border Health - Language | `contact.border_health__language` | `9SBpVIPJG3sJBzV2AIl9` | SINGLE_OPTIONS |
| `bh_responses.ref` | Border Health - Lead Source | `contact.border_health__lead_source` | `YoDuec9qIPAHYuF8zi9U` | TEXT |
| `answers.contact_whatsapp` | Border Health - WhatsApp Number | `contact.border_health__whatsapp_number` | `jEi4QIYd2GV1rpTjdeac` | PHONE |
| `answers.follow_up_key` | Border Health - Follow Up Preference | `contact.border_health__follow_up_preference` | `cPvyK7ZrLH8xKvlfflou` | SINGLE_OPTIONS |
| `answers.variant` | Border Health - Form Variant | `contact.border_health__form_variant` | `baXFVU3BB7T7jv5QLt8y` | SINGLE_OPTIONS |
| `bh_responses.submission_key` | Border Health - Submission Key | `contact.border_health__submission_key` | `JgMJzEhKQSUeqTEKcboj` | TEXT |
| Sync timestamp (`YYYY-MM-DD`) | Border Health - Last Submission Date | `contact.border_health__last_submission_date` | `xZBvro0vIGHGXOBdSNJO` | DATE |

*`last_submission_date` is set at GHL sync time (anon insert does not return `bh_responses.created_at`).*

### 6.3 Employer custom fields (`segment = employer`)

| Supabase source | GHL field name | `fieldKey` | GHL field `id` | Type |
|---|---|---|---|---|
| `answers.industry_key` | Border Health - Employer Industry | `contact.border_health__employer_industry` | `5NL0h52GbDd4xNrf4e9w` | SINGLE_OPTIONS |
| `answers.size_key` | Border Health - Employer Size | `contact.border_health__employer_size` | `0RkqV4HKrJAhWfv3VGCE` | SINGLE_OPTIONS |
| `answers.where_key` | Border Health - Employer Employee Location | `contact.border_health__employer_employee_location` | `4krZegTg6ZGShB6aTURC` | SINGLE_OPTIONS |
| `answers.role_key` | Border Health - Employer Contact Role | `contact.border_health__employer_contact_role` | `dQEQdsu2GjK62qp2BhIp` | SINGLE_OPTIONS |
| `answers.coverage_key` | Border Health - Employer Health Coverage | `contact.border_health__employer_health_coverage` | `GiP1zHDqTpvB6gQPgFHd` | MULTIPLE_OPTIONS |
| `answers.insurers` | Border Health - Employer Insurer or Plan | `contact.border_health__employer_insurer_or_plan` | `9njRsudBvGvoMI6axyMk` | TEXT |
| `answers.crossing_key` | Border Health - Employer Employee Cross Border Care | `contact.border_health__employer_employee_cross_border_care` | `p6GGHvP9TmVwmQhcipRD` | SINGLE_OPTIONS |
| `answers.difficulties_key` | Border Health - Employer Healthcare Challenges | `contact.border_health__employer_healthcare_challenges` | `GxGbhMt5n3TyopaOLEMW` | MULTIPLE_OPTIONS |
| `answers.difficulties_top_key` | Border Health - Employer Primary Healthcare Challenge | `contact.border_health__employer_primary_healthcare_challenge` | `SDKqsSdXWNBo9wbbmoAi` | SINGLE_OPTIONS |
| `answers.change` | Border Health - Employer Healthcare Priority | `contact.border_health__employer_healthcare_priority` | `PK8FiJvZZWzdAY9EUbSx` | LARGE_TEXT |

### 6.4 Employee / patient custom fields (`segment = employee`)

| Supabase source | GHL field name | `fieldKey` | GHL field `id` | Type |
|---|---|---|---|---|
| `answers.industry_key` | Border Health - Employee Industry | `contact.border_health__employee_industry` | `XqyPgCrI3nYxYOzlKdpq` | SINGLE_OPTIONS |
| `answers.work_where_key` | Border Health - Employee Work Location | `contact.border_health__employee_work_location` | `pqAH11DBOZVOyukgymkv` | SINGLE_OPTIONS |
| `answers.live_where_key` | Border Health - Employee Residence | `contact.border_health__employee_residence` | `9PpEMJPAgYCLiRsjjEwf` | SINGLE_OPTIONS |
| `answers.coverage_key` | Border Health - Employee Health Coverage | `contact.border_health__employee_health_coverage` | `nRlEc1y1E1L7lGpKUWzn` | MULTIPLE_OPTIONS |
| `answers.last_hardest_key` | Border Health - Employee Healthcare Access Challenges | `contact.border_health__employee_healthcare_access_challenges` | `T2MVMgougTpMudZr2rMT` | MULTIPLE_OPTIONS |
| `answers.last_hardest_top_key` | Border Health - Employee Primary Healthcare Access Challenge | `contact.border_health__employee_primary_healthcare_access_challenge` | `BGCifzbWaFVSXE6uC9iF` | SINGLE_OPTIONS |
| `answers.crossed_key` | Border Health - Employee Cross Border Care Usage | `contact.border_health__employee_cross_border_care_usage` | `bl8JbFYfIyEshlyHhK45` | SINGLE_OPTIONS |
| `answers.change` | Border Health - Employee Healthcare Improvement Priority | `contact.border_health__employee_healthcare_improvement_priority` | `Npvqe0o3FZ2QcB0c4IHc` | LARGE_TEXT |

### 6.5 Provider custom fields (`segment = provider`)

| Supabase source | GHL field name | `fieldKey` | GHL field `id` | Type |
|---|---|---|---|---|
| `answers.practice_type_key` | Border Health - Provider Practice Type | `contact.border_health__provider_practice_type` | `mwYMjg4kprTVOXskfdRC` | SINGLE_OPTIONS |
| `answers.specialty` | Border Health - Provider Specialty | `contact.border_health__provider_specialty` | `82F6b0evLmPVEMOOfrlR` | TEXT |
| `answers.city_key` | Border Health - Provider Location | `contact.border_health__provider_location` | `XrtqODHTiJOMmZGqHf1I` | SINGLE_OPTIONS |
| `answers.size_key` | Border Health - Provider Practice Size | `contact.border_health__provider_practice_size` | `Lc9ov7VHDvtwSivCCY7I` | SINGLE_OPTIONS |
| `answers.us_patients_key` | Border Health - Provider Cross Border Patient Share | `contact.border_health__provider_cross_border_patient_share` | `vdzjfxJX5mwCrOSDnhyV` | SINGLE_OPTIONS |
| `answers.presence_key` | Border Health - Provider Online Presence | `contact.border_health__provider_online_presence` | `6hTf0PyWDMhOqpKA7se6` | MULTIPLE_OPTIONS |
| `answers.website` | Border Health - Provider Website | `contact.border_health__provider_website` | `pbIBn4NNWZ0Rk5b3CCiR` | TEXT |
| `answers.booking_key` | Border Health - Provider Booking Methods | `contact.border_health__provider_booking_methods` | `O1bHe4VZMkVtjFhTVl4U` | MULTIPLE_OPTIONS |
| `answers.english_key` | Border Health - Provider English Availability | `contact.border_health__provider_english_availability` | `6OXw6yidX3WczV41b0XR` | SINGLE_OPTIONS |
| `answers.virtual_key` | Border Health - Provider Virtual Visits | `contact.border_health__provider_virtual_visits` | `5o1LPiViR5guCqvVHqUE` | SINGLE_OPTIONS |
| `answers.payments_key` | Border Health - Provider Payment Methods | `contact.border_health__provider_payment_methods` | `zYEO8880t5EYa1EM79LA` | MULTIPLE_OPTIONS |
| `answers.insurers` | Border Health - Provider Accepted Insurers | `contact.border_health__provider_accepted_insurers` | `o0UyjpLPhzoFV9vtCi0L` | TEXT |
| `answers.imaging_key` | Border Health - Provider On-Site Services | `contact.border_health__provider_onsite_services` | `XpMCf6bQAEP3NrbSa7Te` | MULTIPLE_OPTIONS |
| `answers.process_hardest_key` | Border Health - Provider Primary Process Challenge | `contact.border_health__provider_primary_process_challenge` | `JSlT0keTpWKaWn62D4a6` | SINGLE_OPTIONS |
| `answers.bottlenecks_key` | Border Health - Provider Challenges | `contact.border_health__provider_challenges` | `1tIPg8ZjTZFVhwqyHa0K` | MULTIPLE_OPTIONS |
| `answers.bottlenecks_top_key` | Border Health - Provider Primary Challenge | `contact.border_health__provider_primary_challenge` | `GOJ6I7dnWbOPyyh3M1v2` | SINGLE_OPTIONS |
| `answers.referrals_key` | Border Health - Provider Referral Interest | `contact.border_health__provider_referral_interest` | `RDi7pQSqKzMOMI09Bbrb` | SINGLE_OPTIONS |

### 6.6 Tags and contact note

Tags (unchanged):

* `borderhealth`
* `borderhealth-<employer|employee|provider>`
* `borderhealth-followup` or `borderhealth-no-followup`
* `borderhealth-info-first` (if applicable)
* `borderhealth-v-<research|medsociety>`
* `borderhealth-test` (if `session=test`)

A note is still posted to `POST /contacts/{id}/notes` with segment, language, ref, industry/practice label, location label, follow-up summary, WhatsApp if distinct, and a pointer to Supabase.

### 6.7 Supabase-only (not synced to GHL)

| Segment | Supabase field |
|---|---|
| Employer | `answers.help_how_key` |
| Employee | `answers.tier_key`, `answers.deduction_key`, `answers.deduction_usd_key`, `answers.last_doctor_key`, `answers.last_dentist_key`, `answers.last_what_key`, `answers.workaround_key`, `answers.records_key` |
| Provider | `answers.process`, `answers.records_key` |
