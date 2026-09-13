# RAG Evaluation Question Set (Danish)

Same 45 questions as `rag_qa_pairs.md`, translated to Danish, kept against the same three
(English-language) source PDFs. This dataset exercises cross-lingual RAG: a Danish-language
query must still retrieve the right English document and produce an answer that a Danish
reference answer can be judged against.

15 questions per document (5 easy / 5 medium / 5 hard) — 45 total.
Difficulty definitions used:
- **Easy**: single fact, directly stated, one location in the doc.
- **Medium**: requires reading a short paragraph/table and light synthesis (a "why" or a list of items).
- **Hard**: requires cross-referencing multiple sections, comparing values across a table, or tracing a multi-step procedure/responsibility chain.

---

## Document 1: OPNL_B01_EN.pdf — "Operational Safety / Safety Instructions" (Rev 4_0, 7 Nov 2024)

### Easy

**Q1.** Hvad er det minimale generelle belysningsniveau (i lux), der skal etableres på og omkring maskinen?
**A1.** 300 lux. (Afsnit 3.8)

**Q2.** Hvad er minimumsalderen, en passager skal have for at betjene CrisBag® Self Bag Drop (SBD)?
**A2.** 15 år, og personen skal have normal menneskelig styrke. (Afsnit 3.6.6)

**Q3.** Hvilket belysningsniveau kræves specifikt ved arbejdspladserne (i modsætning til den generelle områdebelysning)?
**A3.** 500 lux. (Afsnit 3.8)

**Q4.** Hvilken farve og geometrisk form repræsenterer skiltekategorien "Advarsel" (kategori W) i dokumentets system for sikkerhedsskilte?
**A4.** En gul trekant. (Afsnit 6.3, kategori W)

**Q5.** Hvilken revision af dette dokument er den aktuelle, og hvornår blev den udgivet?
**A5.** Revision 4_0, udgivet 7. november 2024. (Forside / Afsnit 1, Revisioner)

### Medium

**Q6.** Over hvilken frit-fald-højde skal der anvendes sikkerhedsforanstaltninger (f.eks. stillads, rækværk eller sikkerhedssele) ved arbejde i højden?
**A6.** Mere end 2,0 meters potentielt frit fald. (Afsnit 3.1.2 og 3.6.3)

**Q7.** Nævn mindst tre af de fem kategorier af dokumentation, der skal opbevares i logbogen for et CrisStore®-modul.
**A7.** Tre vilkårlige af: udfyldte vedligeholdelsesskemaer, der dokumenterer udført planlagt vedligeholdelse; en oversigt over fejl konstateret under drift; dokumentation for alle større reparationer; dokumentation for afprøvninger efter ændringer eller ombygning; dokumentation for afprøvninger foretaget under fremstillingen af miniloaderen. (Afsnit 3.4)

**Q8.** Hvor længe anses det for acceptabelt udelukkende at stole på en sikkerhedssele som nødløsning til faldsikring?
**A8.** Ved opgaver af kort varighed, normalt under fire mandtimer. (Afsnit 3.7.1)

**Q9.** Inden personer må gå ind i det indhegnede område omkring en CrisStore®-miniloader, hvilke to handlinger skal da udføres i forbindelse med hovedafbryderen?
**A9.** Hovedafbryderen på LCC Master skal drejes til positionen '0/OFF' for at afbryde forsyningsspændingen til miniloaderens motorer, og den skal derefter låses med den indtrædende persons personlige hængelås. (Afsnit 3.6.2)

**Q10.** Hvilke to overordnede kategorier af sikkerhedsanordninger anvendes til at sikre maskinens farezoner mod uautoriseret adgang?
**A10.** Faste afskærmninger (f.eks. hegn) og bevægelige afskærmninger (f.eks. døre), som om nødvendigt er udstyret med lås- og interlockanordninger. (Afsnit 3.11)

### Hard

**Q11.** Sammenlign den obligatoriske uddannelse for en almindelig "anden drift"-medarbejder med en medarbejder inden for "rengøring, vedligeholdelse og reparation" ifølge uddannelsesmatricen — hvilket modul er obligatorisk for begge, og hvilke yderligere moduler bliver kun obligatoriske for vedligeholdelsesrollen?
**A11.** "Operatøruddannelse, modul 1" er obligatorisk for både drifts- og rengørings-/vedligeholdelses-/reparationsroller. Rollen inden for rengøring/vedligeholdelse/reparation kræver derudover "Styringsuddannelse, modul 1" og "Vedligeholdelsesuddannelse, modul 1" som obligatoriske, mens "Operatøruddannelse modul 2", "Styringsuddannelse modul 2" og "Vedligeholdelsesuddannelse modul 2" er valgfrie genopfriskningskurser. (Afsnit 5.1, uddannelsesmatrix)

**Q12.** Ifølge revisionshistorikken, i hvilken revision blev sikkerhedsindholdet for CrisBag® Self Bag Drop (SBD) først introduceret, og hvilke specifikke underafsnit blev tilføjet på det tidspunkt?
**A12.** Revision 3_0 (13. november 2023), som tilføjede SBD-indholdet til afsnit 3.6 sammen med de nye underafsnit 3.6.6, 3.6.7, 3.6.8 og 3.6.9. (Afsnit 1, Revisioner)

**Q13.** Gennemgå den fuldstændige firetrinsprocedure, der kræves for at genstarte maskinen efter et nødstop, herunder hvem der er bemyndiget til at udføre det centrale trin.
**A13.** (1) Undersøg årsagen til nødstoppet, og fjern faren; (2) deaktiver det lokale nødstop; (3) genaktiver nødstopsrelæet, hvilket kræver en sikkerhedsnøgle, som kun en bemyndiget person besidder; (4) kvittér for nødstopsmeddelelsen i styresystemet. (Afsnit 4.1)

**Q14.** Hvad må under nedtagning af maskinen aldrig fjernes, før selve maskinkroppen er fuldstændigt demonteret, og hvorfor er det vigtigt set i forhold til de øvrige trin i proceduren?
**A14.** Understøtninger eller platforme må aldrig fjernes, før maskinkroppen er blevet demonteret — dette er vigtigt, fordi proceduren kræver, at delene fjernes oppefra og ned, og at maskinen holdes stabil hele vejen igennem, da ustabilitet og oplagret/potentiel energi udtrykkeligt er angivet som farer ved nedtagningsprocessen. (Afsnit 3.14)

**Q15.** Dokumentet nævner to separate farer forbundet med CrisBag® SBD's frontlåge (afsnit 3.6.8 og 3.6.9). Hvad er de, og hvilken enkelt forholdsregel gives der for begge?
**A15.** Afsnit 3.6.8 advarer om klemning af hænder og fingre, fordi frontlågen lukker automatisk; afsnit 3.6.9 advarer om, at tøj eller lignende genstande kan blive fanget i drivremskiven. Begge afsnit giver den samme forholdsregel: hold afstand, når frontlågen lukker.

---

## Document 2: OPNL_B02_EN.pdf — "Prerequisites for Access" (Rev 2:0, 13 Nov 2023)

### Easy

**Q1.** Hvor mange forskellige personprofiler definerer dokumentet for adgang til systemet?
**A1.** Fire: Eksponeret person, operatør (normal drift), kontrolrumsoperatør og servicetekniker. (Afsnit 3.2)

**Q2.** Hvilken betingelse skal være opfyldt, før en "eksponeret person" overhovedet må opholde sig i nærheden af systemet?
**A2.** Personen skal altid ledsages af en servicetekniker, der har tilladelse til at færdes i og omkring systemet. (Afsnit 3.2.1)

**Q3.** Hvorfor angives "walk-over" (overgangsbro) som den foretrukne metode til at krydse transportør-/CrisBag®-systemet?
**A3.** Fordi en gangbro over udstyret ikke afbryder transportflowet, så systemet ikke behøver at blive stoppet. (Afsnit 5.2)

**Q4.** Hvilken fri bredde giver walk-through-lågen, når den åbnes til sin 90-graders position?
**A4.** 700 mm. (Afsnit 5.6)

**Q5.** Hvilken visuel metode anvendes til at markere flugtveje på gulvet/platformen, ifølge afsnit 4.1?
**A5.** Selvlysende pile eller tape. (Afsnit 4.1)

### Medium

**Q6.** Hvordan adskiller en kontrolrumsoperatørs adgang til maskiner med generel afskærmning sig fra en serviceteknikers?
**A6.** En kontrolrumsoperatør må slet ikke få adgang til farlige maskiner udstyret med generel afskærmning (f.eks. udkast, løftere, omstyringsenheder, mellem-/højhastighedslinjer), mens en servicetekniker har tilladelse til at få adgang til den samme afskærmede maskine, når energiforsyningen er afbrudt. (Afsnit 3.3.3 og 3.3.4)

**Q7.** Hvilke fire uddannelsesmoduler skal en servicetekniker gennemføre ifølge tabel 3-1?
**A7.** Operatøruddannelse, styringsuddannelse, hardwareuddannelse og vedligeholdelsesuddannelse. (Tabel 3-1)

**Q8.** Hvad er formålet med den beskyttelsesafskærmning, der installeres, hvor der er passage under en transportør eller et CrisBag®-element?
**A8.** Den forhindrer, at personen, der passerer nedenunder, kan række ind i maskinen. (Afsnit 5.3)

**Q9.** Funktionelt set, hvordan adskiller en "step-in"-krydsning sig fra en "walk-through"-krydsning, ud over at begge kræver, at CrisBag®-linjen stoppes?
**A9.** En step-in er et enkelt CrisBag®-element forsynet med en trædeflade og små trin på hver side, som anvendes, hvor andre adgangsmuligheder ikke er mulige på grund af bygnings- eller udstyrsbegrænsninger. En walk-through anvender derimod en dedikeret låge, der drives af et tilstødende element og svinger 90 grader op (hvilket giver 700 mm bredde), og som kan anvendes i både et- og toplans-systemer. (Afsnit 5.5 og 5.6)

**Q10.** Hvordan opretholdes adskillelsen mellem operatørernes flugtveje og vedligeholdelsesområderne, og hvordan kan de adskillende døre åbnes i en nødsituation?
**A10.** Hegn eller bygningens egne vægge adskiller operatørernes adgangs-/flugtveje fra vedligeholdelsesområderne, og dørene mellem dem har en låsefunktion indbygget i dørhåndtaget, så kun kvalificeret (eller ledsaget) personale kan passere — men disse døre kan altid åbnes fra vedligeholdelsessiden i tilfælde af brand eller andre ulykker. (Afsnit 4.2)

### Hard

**Q11.** Ud fra tabel 3-1 og afsnit 3.3.3, forklar præcist, hvorfor en kontrolrumsoperatørs adgang ligger "mellem" en operatørs og en serviceteknikers — hvilken specifik begrænsning holder den under serviceteknikerniveauet, selvom den dækker flere zoner end operatøren?
**A11.** En kontrolrumsoperatør får efter uddannelse adgang til farezonen ud over de begrænsede områder og trafikområder, som en operatør er begrænset til — altså bredere end en operatør. Kontrolrumsoperatøren er imidlertid udtrykkeligt udelukket fra enhver maskine udstyret med generel afskærmning (udkast, løftere, omstyringsenheder, mellem-/højhastighedslinjer) uanset uddannelse, mens en servicetekniker kan få adgang til netop den afskærmede maskine, når energien er afbrudt. Denne specifikke undtagelse er det, der holder kontrolrumsoperatørens adgang under serviceteknikerens.

**Q12.** Ved at krydsreferere revisionsloggen og afsnit 5.7: hvilket nyt adgangsrelateret emne blev introduceret i revision 2_0, og hvor skal en læser gå hen for at finde den fulde procedure?
**A12.** Revision 2_0 tilføjede tekst og en henvisning til "Undtagelsesvis adgang", som bemærker, at det ved noget sikkerhedsafskærmet udstyr er nødvendigt at fjerne hegnet for at få adgang — den fulde procedure herfor er beskrevet i kapitel B-3. (Afsnit 1, Revisioner; afsnit 5.7)

**Q13.** Redegør for den fulde ansvarskæde, fra start til slut, når en operatør bemærker en fejl i systemet.
**A13.** Operatøren har ikke lov til selv at gribe ind for at afhjælpe fejlen; vedkommende skal melde det til kontrolrummet eller en servicetekniker (afsnit 3.3.2). Kun uddannede serviceteknikere må rent faktisk afhjælpe fejl på CrisBag®-systemet (afsnit 5.9). Kontrolrummet overtager ansvaret for at udsende en servicetekniker. Hvis der er tale om et nødstop, kan systemet først nulstilles, når serviceteknikeren har fundet årsagen og bekræftet, at der ikke er nogen fare ved at genoptage automatisk drift, hvorefter det meldes tilbage til kontrolrummet, at systemet er sat tilbage til automatisk drift (afsnit 5.8).

**Q14.** Hvilken mekanisk sikkerhedsredundans findes der ved en "step-in"-krydsning ud over det almindelige sikre adgangskontrolsystem, og hvilken specifik fejltilstand beskytter den imod?
**A14.** Step-in'en er derudover sikret med et mekanisk system, der forhindrer totes i at ramme en person, der går gennem elementet, hvis der opstår en PLC-fejl — det er med andre ord en mekanisk sikring mod en fejl i styresystemet (software/PLC), ikke blot en elektronisk interlock. (Afsnit 5.5)

**Q15.** Ved at sammenholde afsnit 3.2.2 og 3.3, forklar hvorfor en operatør er begrænset til de etablerede, bredere adgangsveje med overgangsbroer i stedet for at anvende step-in-/walk-through-enhederne, der krydser direkte gennem CrisBag®-linjen.
**A15.** Operatørers adgangstilladelse er udtrykkeligt begrænset til afgrænsede opgaver inden for de begrænsede områder og trafikområder, ved hjælp af ruter designet til at være brede med sikre overgangsbroer — dette er det adgangsniveau, de får efter kun at have gennemført "operatøruddannelse". Step-ins og walk-throughs krydser direkte ind i/gennem selve CrisBag®-linjen, som er en del af den zone, der er forbeholdt personale uddannet i styrings-, hardware- og/eller vedligeholdelsesmoduler (kontrolrumsoperatører og serviceteknikere). Da operatører ikke er uddannet eller bemyndiget til direkte adgang på tværs af linjen, sikrer systemets design, at de i stedet holdes på de adskilte, bredere ruter.

---

## Document 3: Operating_instructions_CLV69x_Bar_code_scanners_en_IM0045360.pdf (SICK CLV69x, 134 pages)

### Easy

**Q1.** Hvad er den angivne tilsigtede anvendelse for CLV69x?
**A1.** Det er en intelligent optoelektronisk ID-sensor, der anvendes til automatisk, fast identifikation og afkodning af stregkoder på bevægelige eller stationære objekter, og som sender de afkodede data til en overordnet PLC til videre bearbejdning. (Afsnit 2.1)

**Q2.** Hvilken laserklasse overholder CLV69x?
**A2.** Laserklasse 2, i henhold til EN/IEC 60825-1. (Afsnit 2.7.1 og 12.1)

**Q3.** Hvad er enhedens kapslingsklasse (IP-beskyttelsesgrad)?
**A3.** IP 65. (Afsnit 12.4)

**Q4.** Hvilket software anvendes til at konfigurere enheden?
**A4.** Konfigurationssoftwaren SOPAS ET. (Afsnit 12.3 og kapitel 7)

**Q5.** Hvilken farve har enhedens kabinet?
**A5.** Lyseblå (RAL 5012). (Afsnit 12.4)

### Medium

**Q6.** Ifølge kapitlet om lasersikkerhed, hvor længe kan det menneskelige øje kortvarigt udsættes for strålen, uden at det anses for at være en risiko?
**A6.** Op til 0,25 sekunder; længere eksponering kan skade nethinden. (Afsnit 2.7.1)

**Q7.** Hvilke data kan potentielt gå tabt, når enheden blot slukkes?
**A7.** Applikationsspecifikke parametersæt, som kun var midlertidigt gemt, det seneste læseresultat samt den daglige driftstimetæller. (Afsnit 2.8)

**Q8.** Hvad er scanningsfrekvensområdet og læseafstandsområdet for CLV690 Standard Density-varianten?
**A8.** Scanningsfrekvens 400 Hz til 1200 Hz; læseafstand 500 mm til 2100 mm. (Afsnit 12.1)

**Q9.** Hvilken central forholdsregel angiver manualen for rengøring af læsevinduet, og hvorfor er det vigtigt?
**A9.** Rengør kun læsevinduet, mens det er vådt, med et mildt, pulverfrit rengøringsmiddel, og undgå enhver bevægelse, der kan ridse eller slide på det — fordi ridser eller striber forringer læseevnen. (Afsnit 9.2.1)

**Q10.** Hvad er forsyningsspændingsområdet for en enhed uden opvarmning sammenlignet med en med opvarmning?
**A10.** Uden opvarmning: 18 V DC til 30 V DC; med opvarmning: 21,6 V DC til 28,8 V DC. (Afsnit 12.4)

### Hard

**Q11.** Sammenlign læseafstands- og kodeopløsningsområderne på tværs af varianterne Standard, Low Density og High Density, og forklar den afvejning, tallene afslører.
**A11.** Standard (CLV690): 500-2100 mm afstand, 0,25-1,0 mm opløsning. Low Density (CLV691): 500-2200 mm afstand (den længste rækkevidde), 0,35-1,2 mm opløsning (den groveste). High Density (CLV692): 400-1600 mm afstand (den korteste rækkevidde), 0,17-0,4 mm opløsning (den fineste). Mønstret viser en direkte afvejning: den variant, der er tunet til den længste læseafstand, har den groveste opnåelige opløsning, mens den variant, der kan opnå den fineste opløsning, kun fungerer på kortere afstand. (Afsnit 12.1)

**Q12.** Forklar samspillet mellem funktionen "laser timeout" og PSDI-læsetilstande — under hvilke specifikke driftsbetingelser bliver timeout-indstillingen virkningsløs, selv hvis den er aktiveret?
**A12.** Laser timeout skal automatisk slukke laserdioden, hvis triggerimpulsen udebliver for længe (f.eks. ved en stoppet transportør). Laserdioden er imidlertid permanent eller gentagne gange tændt uanset dette under tilstandene "Percentage Evaluation" og "Auto Setup" samt under læsedrift i PSDI-typerne "Auto pulse" (justerbar driftscyklus) eller "free". I alle disse tilstande har en aktiveret timeout ingen effekt. (Afsnit 2.7.1)

**Q13.** Ifølge de tekniske data for grænseflader, hvilke cloning-stik muliggør seriel kommunikation (RS-232/RS-422/-485), og hvilke muliggør Ethernet, og hvilke protokoller understøtter Ethernet-grænsefladen?
**A13.** Seriel kommunikation kræver cloning-stik 2062450, 2062452, 2062453 eller 2062454. Ethernet kræver cloning-stik 2062452, 2074708 eller 2074710 og understøtter TCP/IP, EtherNet/IP og PROFINET (sidstnævnte eventuelt via et eksternt CDF 600-22xx feltbusmodul, herunder en PROFINET DualPort-mulighed). (Afsnit 12.3)

**Q14.** Gennemgå den fulde, sikkerhedsbevidste rengøringssekvens for læsevinduet, herunder laserforholdsreglen og de forskellige metoder for glas- kontra plastiklinser.
**A14.** Sluk først enheden i hele rengøringsperioden, eller bær, hvis dette ikke er muligt, laserbeskyttelsesbriller godkendt til enhedens bølgelængde. For en glaslinse: fjern støv med en blød, ren børste, og rengør derefter om nødvendigt yderligere med en ren, fugtig, fnugfri klud og et mildt antistatisk glasrengøringsmiddel. For en plastiklinse: spring den tørre børstning over, og rengør kun med en ren, fugtig, fnugfri klud plus det samme milde antistatiske glasrengøringsmiddel. Hvis vinduet er ridset, revnet eller ødelagt, skal det udskiftes af SICK Service i stedet for at blive rengjort. (Afsnit 9.2.1)

**Q15.** Ved at sammenholde afsnit 2.2 (Ukorrekt brug) og 2.4 (Ansvarsbegrænsning), beskriv et scenarie, hvor begge af SICK's ansvarsfraskrivelsesklausuler ville gælde for samme hændelse samtidigt.
**A15.** Hvis en kunde både (a) anvender enheden uden for dens tilsigtede formål eller tekniske specifikation — f.eks. ved at installere den i et eksplosionsfarligt eller korrosivt miljø, hvilket afsnit 2.2 udtrykkeligt betegner som ukorrekt brug — og (b) også har foretaget en uautoriseret ombygning eller teknisk ændring af enheden, vil begge ansvarsfraskrivelsesgrunde i afsnit 2.4 (ukorrekt brug samt uautoriserede ombygninger/tekniske ændringer) gælde for samme hændelse, hvilket forstærker SICK AG's ansvarsfraskrivelse.

---

### Notes for test setup
- Page/section references above point to the source location for verification but are not required in a model's answer unless your grading rubric asks for citations.
- "Hard" questions are intentionally designed so the answer cannot be found in one contiguous passage — a model that only does single-chunk retrieval is likely to under-perform on these, which makes them useful for evaluating multi-hop RAG retrieval.
- This dataset is a Danish translation of `rag_qa_pairs.json`/`rag_qa_pairs.md`, run against the same English source PDFs. It specifically tests cross-lingual retrieval (a Danish question must still surface the right English document) and cross-lingual judging (the LLM judge compares a generated answer against a Danish reference answer).
