# PKS Live

PKS Live to aplikacja webowa i androidowa do śledzenia autobusów PKS w czasie zbliżonym do rzeczywistego. Aplikacja pokazuje pojazdy na mapie, listę przystanków, najbliższe odjazdy oraz panel administratora do zarządzania urządzeniami, rolami i blokadami.

Projekt jest zbudowany w Next.js, React i Capacitor, a backend administracyjny działa na Firebase.

## Najważniejsze funkcje

- mapa autobusów z aktualnymi pozycjami pojazdów,
- informacje o linii, kierunku, statusie pojazdu, opóźnieniu i kolejnych przystankach,
- lista przystanków z wyszukiwarką,
- podgląd najbliższych odjazdów z wybranego przystanku,
- ulubione przystanki zapisywane lokalnie na urządzeniu,
- tryby wyglądu aplikacji i wybór koloru akcentu,
- obsługa Androida przez Capacitor,
- panel administratora z zarządzaniem urządzeniami, operatorami, banami i logami,
- tryb przerwy technicznej dla zwykłych użytkowników,
- blokowanie dostępu do mapy albo przystanków dla konkretnych użytkowników.

## Zakładki aplikacji

### Mapa

Zakładka `Mapa` pokazuje aktywne autobusy PKS na mapie. Dane pojazdów są pobierane cyklicznie z zewnętrznego API:

`https://www.mpkrzeszow.pl/pks/get_vehicles.php`

Na mapie użytkownik widzi:

- numer linii,
- pozycję autobusu,
- kierunek jazdy,
- prędkość,
- opóźnienie,
- status pojazdu, np. w trasie, postój, przerwa, przejazd techniczny,
- kolejne przystanki z planowanymi i realnymi godzinami.

Aplikacja filtruje bardzo stare pozycje pojazdów, żeby nie pokazywać autobusów, które dawno nie wysłały sygnału.

### Przystanki

Zakładka `Przystanki` zawiera listę przystanków pobieraną z API `einfo.zgpks.rzeszow.pl`. Użytkownik może wyszukać przystanek, dodać go do ulubionych i otworzyć szczegóły.

Dane przystanków zawierają:

- nazwę przystanku,
- ID przystanku,
- ID zespołu przystankowego,
- kod słupka,
- współrzędne GPS, jeśli API je udostępnia.

Po wejściu w przystanek aplikacja pobiera najbliższe odjazdy oraz uzupełnia je rozkładem z tablicy przystankowej. Dzięki temu odjazdy mogą być widoczne także wtedy, gdy API live nie zwróci wszystkich kursów.

### Opcje

Zakładka `Opcje` pozwala zmienić wygląd aplikacji:

- tryb systemowy,
- jasny,
- piaskowy,
- ciemny,
- AMOLED,
- Aurora,
- kolor akcentu,
- efekt przezroczystości UI,
- pokazywanie autobusów bez przypisanej linii.

Ustawienia są zapisywane lokalnie w `localStorage`.

### Admin

Zakładka `Admin` pojawia się tylko dla urządzeń z odpowiednią rolą i uprawnieniami. Dostęp mają:

- właściciel,
- administrator z uprawnieniem monitorowania/listy urządzeń.

Panel admina jest dostępny jako część aplikacji oraz jako osobna strona `/admin`.

## Panel administratora

Panel administratora służy do zarządzania urządzeniami korzystającymi z aplikacji. Każde urządzenie jest rejestrowane w Firestore po zalogowaniu anonimowym Firebase.

### Urządzenia

Widok `Urządzenia` pokazuje listę zarejestrowanych urządzeń. Administrator widzi:

- nazwę lub identyfikator urządzenia,
- system/typ urządzenia,
- rolę,
- status,
- pierwsze logowanie,
- ostatnią aktywność,
- informację czy urządzenie jest online.

Z tego widoku można:

- zmienić rolę użytkownika,
- zmienić uprawnienia,
- zablokować urządzenie,
- przejść do ekranu testowego blokady.

### Administratorzy

Widok `Administratorzy` pokazuje konta z rolą `owner` albo `admin`.

Możliwe działania:

- edycja operatora,
- zmiana roli,
- nadawanie i odbieranie uprawnień,
- zdegradowanie operatora do zwykłego użytkownika,
- edycja ustawień globalnych, jeśli użytkownik ma odpowiednie uprawnienie.

Właściciel ma pełne uprawnienia i jako jedyny może nadawać rolę właściciela.

### Bany / Blokady

Widok `Bany / Blokady` pokazuje zablokowane urządzenia oraz statystyki blokad.

Blokada może zawierać:

- powód,
- datę wygaśnięcia,
- informację kto zablokował,
- datę nadania blokady,
- opcjonalny link do GIF-a,
- tryb cichy, w którym użytkownik widzi zwykły komunikat błędu zamiast ekranu bana.

Administrator z uprawnieniem banowania może blokować i odblokowywać zwykłych użytkowników. Właściciel ma pełną kontrolę.

### Logi aktywności

Widok `Logi aktywności` pokazuje historię działań administracyjnych.

Logowane są między innymi:

- zmiany ról,
- zmiany uprawnień,
- nadanie blokady,
- zdjęcie blokady,
- zmiany ustawień globalnych.

Właściciel może czyścić logi.

### Ustawienia globalne

Ustawienia globalne są przechowywane w dokumencie:

`admin_settings/security`

Dostępne ustawienia:

- `loginEnabled` - przełącznik logowania,
- `maintenanceMode` - tryb przerwy technicznej,
- `autoBan` - przełącznik automatycznych blokad.

Tryb przerwy technicznej blokuje zwykłym użytkownikom korzystanie z aplikacji i pokazuje ekran konserwacji. Administratorzy i właściciel nadal mogą korzystać z aplikacji.

## Role i uprawnienia

System używa trzech ról:

- `owner` - właściciel, pełne uprawnienia,
- `admin` - administrator, domyślnie ma dostęp do listy urządzeń i banowania,
- `user` - zwykły użytkownik.

Główne uprawnienia:

- `monitor` - dostęp do listy urządzeń i panelu admina,
- `shield` - dostęp do sekcji administratorów/operatorów,
- `group` - dostęp do widoku banów,
- `logs` - dostęp do logów,
- `ban` / `canBan` - możliwość banowania,
- `canChangeRoles` - możliwość zmiany ról,
- `disableMap` - wyłączenie zakładki mapy dla użytkownika,
- `disableStops` - wyłączenie zakładki przystanków dla użytkownika,
- `globalSettings` - podgląd ustawień globalnych,
- `globalSettingsEdit` - edycja ustawień globalnych.

## Backend i dane

### Firebase Authentication

Aplikacja używa anonimowego logowania Firebase. Po uruchomieniu aplikacji użytkownik otrzymuje `uid`, które identyfikuje dokument urządzenia w Firestore.

Jeśli anonimowe logowanie jest wyłączone, aplikacja ma awaryjny lokalny identyfikator gościa do testów, ale pełne funkcje administracyjne wymagają Firebase.

### Firestore

Najważniejsze kolekcje:

- `devices` - urządzenia użytkowników, role, statusy, uprawnienia, ostatnia aktywność,
- `installations` - profil instalacji, pozwala zachować rolę po zmianie UID,
- `blocked_installations` - blokady przypisane do instalacji,
- `admin_logs` - historia działań administracyjnych,
- `admin_settings` - ustawienia globalne aplikacji.

### Firebase bez Blaze

Aplikacja nie wymaga Firebase Functions. Rejestracja urządzenia, role, bany, logi i ustawienia globalne działają przez Firestore oraz reguły z `firestore.rules`.

Nie uruchamiaj:

```bash
firebase deploy --only functions
```

Ten wariant wymaga planu Blaze, bo Firebase musi włączyć Cloud Build oraz Artifact Registry.

### Zewnętrzne API

Aplikacja korzysta z dwóch źródeł:

1. API pojazdów:

`https://www.mpkrzeszow.pl/pks/get_vehicles.php`

Zwraca aktualne pojazdy, pozycje GPS, kursy, opóźnienia i kolejne przystanki.

2. API przystanków i odjazdów:

`http://einfo.zgpks.rzeszow.pl/api`

Używane endpointy:

- `stop-point` - lista przystanków,
- `its/infoboard/nearest-departures/{stopId}` - najbliższe odjazdy,
- `stop-point-timetable/{areaId}?day=YYYY-MM-DD` - rozkład dla zespołu przystankowego.

### Dane statyczne

W katalogu `public/data` znajdują się pliki pomocnicze:

- `stops-dictionary.json` - lokalny słownik nazw przystanków,
- `trip-shape-index.json` - indeks tras,
- `route-stop-shape-index.json` - indeks przebiegów po sekwencji przystanków,
- `route-shape-metadata.json` - lekki indeks geometrii do dopasowania trasy po przystankach,
- `route-shapes/*.json` - małe pliki z punktami pojedynczych przebiegów tras.

Służą jako cache/fallback oraz do rysowania przebiegu tras.

## Android

Aplikacja jest pakowana na Androida przez Capacitor. Konfiguracja znajduje się w:

- `capacitor.config.ts`,
- `android/`,
- `android/app/src/main/AndroidManifest.xml`.

Ponieważ API `einfo` działa po `http`, Android ma włączone:

`android:usesCleartextTraffic="true"`

Po zmianach w webowej części aplikacji trzeba zsynchronizować projekt Androida:

```bash
npm run android:sync
```

## Uruchomienie lokalne

Instalacja zależności:

```bash
npm install
```

Uruchomienie aplikacji webowej:

```bash
npm run dev
```

Build produkcyjny:

```bash
npm run build
```

Build i synchronizacja Androida:

```bash
npm run android:sync
```

Otwarcie projektu Android:

```bash
npm run android:open
```

Build APK debug:

```bash
npm run android:build:debug
```

Build release bundle:

```bash
npm run android:build:release
```

## Firebase

Deploy reguł Firestore:

```bash
firebase deploy --only firestore
```

Deploy całego Firebase z aktualnej konfiguracji:

```bash
firebase deploy
```

## Publikacja na GitHub

Pierwsze wrzucenie projektu:

```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/sigma943/Aplikacja-android-FINAL.git
git push -u origin main
```

Jeśli remote `origin` już istnieje:

```bash
git remote set-url origin https://github.com/sigma943/Aplikacja-android-FINAL.git
git push -u origin main
```

## Struktura projektu

- `app/` - główne strony Next.js,
- `app/page.tsx` - główny ekran aplikacji,
- `app/admin/` - panel administratora,
- `components/` - komponenty współdzielone, m.in. mapa autobusów,
- `lib/` - klient API, Firebase, logika pomocnicza,
- `functions/` - archiwalne Firebase Cloud Functions, nieużywane przy planie bez Blaze,
- `public/data/` - dane statyczne tras i przystanków,
- `android/` - projekt Android generowany przez Capacitor,
- `assets/` - zasoby ikon/splash screen.

## Podsumowanie działania

Po uruchomieniu aplikacja loguje użytkownika anonimowo w Firebase, rejestruje jego urządzenie w Firestore i sprawdza status konta. Jeśli użytkownik nie jest zablokowany i nie trwa przerwa techniczna, widzi aplikację z mapą, przystankami i opcjami. Dane autobusów są pobierane cyklicznie z API pojazdów, a przystanki i odjazdy z API `einfo`, bezpośrednio lub przez proxy Firebase.

Administratorzy mają dodatkową zakładkę `Admin`, gdzie mogą obserwować urządzenia, nadawać role, zarządzać uprawnieniami, blokować użytkowników i przeglądać logi aktywności.
"# APLIKACjA" 
