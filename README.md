# OctoSQL Veritabanı Motoru

OctoSQL; sıfırdan Node.js ortamında geliştirilmiş, hafif, yüksek performanslı, ilişkisel ve doküman tabanlı bağımsız bir veritabanı motorudur.

Tıpkı SQLite mimarisinde olduğu gibi sıfır harici bağımlılıkla ve sıfır konfigürasyonla çalışabilir. Kendine özgü yapılandırılmış `.osql` depolama formatı, Write-Ahead Logging (`.owal`) mekanizmasıyla işlem güvenliği (ACID), disk üzerinde **AES-256-GCM** kimlik doğrulamalı şifreleme ve modern uygulamalar için çift sözdizimi motoru (Standart ANSI SQL ve OctoSQLX) sunar.

---

## 1. Temel Özellikler

* **Kendi Kendine Yeten Mimari (Self-Contained):** Harici ağır veritabanı sunucularına ihtiyaç duymadan tek bir Node.js süreci veya daemon olarak çalışır.
* **ACID Dayanıklılığı ve WAL:** Tüm yazma ve güncelleme işlemleri önce Write-Ahead Log (`.owal`) dosyasına yazılır, ardından diske atomik olarak senkronize edilir. Olası elektrik kesintisi veya çökme anında sistem başlangıçta kendini otomatik onarır.
* **Disk Üzerinde Kriptografik Güvenlik:** Her tablo `data/<tablo_adi>.osql` dosyasında `OCTOSQL_V1` başlığı ve **AES-256-GCM** şifrelenmiş bloklar halinde saklanır. Diskteki veriye yetkisiz fiziksel erişim veya kurcalama anında veri bütünlüğü korunur.
* **Çift Sözdizimi Desteği (Dual Dialect):**
  - **ANSI SQL:** `SELECT`, `INSERT INTO`, `UPDATE`, `DELETE`, `CREATE TABLE`, `DROP TABLE`, `TRUNCATE`, `SHOW TABLES`, `DESCRIBE`.
  - **OctoSQLX:** Hızlı veri geliştirme için `FETCH`, `STORE`, `MUTATE`, `PURGE`, `SPAWN TABLE`.
* **Dahili Redis Önbellekleme Katmanı:** Sistemde Redis (`127.0.0.1:6379`) mevcutsa otomatik olarak bağlanır; yoksa şeffaf bir şekilde yüksek hızlı dahili bellek (in-memory LRU/TTL) önbelleğine geçer. Yazma işlemlerinde ilgili tablonun önbelleği otomatik geçersiz kılınır.
* **Sistem IP Güvenlik Duvarı:** Yönetim ekranları ve yönetim API'leri yalnızca yetkilendirilmiş sistem IP'lerine (`127.0.0.1`, `::1`) açıktır. Yetkisiz IP'ler `403 Forbidden` ile engellenir ve denetim günlüğüne kaydedilir.
* **Standart SQL İstemci Sürücüsü:** `createPool`, `createConnection`, dizi parçalama (`const [rows, fields] = await db.query(...)`), `?` ile parametre bağlama ve `BEGIN/COMMIT/ROLLBACK` tranzaksiyonlarını tam destekler.
* **OctoAdminer Yönetim Konsolu:** Emojilerden arındırılmış, 16x16 piksel nostaljik masaüstü ikonları içeren, tablo içeriklerinin hem elle hem kodla yönetilmesini sağlayan minimalist yönetim arayüzü.

---

## 2. Desteklenen Veri Tipleri

OctoSQL, dinamik tip dönüşümü ve katı doğrulama ile ilişkisel ve modern veri tiplerinin tümünü destekler:

| Tip Adı | Tanım | Örnek |
| :--- | :--- | :--- |
| `INTEGER` / `INT` | 64-bit tamsayılar | `42`, `-100`, `1024` |
| `FLOAT` / `DECIMAL` | Kayan noktalı reel sayılar | `3.14159`, `99.90` |
| `TEXT` / `VARCHAR` | Değişken uzunluklu UTF-8 metin | `'Merhaba Dünya'` |
| `BOOLEAN` / `BOOL` | Mantıksal doğruluk değeri | `true`, `false` |
| `JSON` | Yapılandırılmış JSON nesneleri ve dizileri | `{"rol": "admin", "izinler": [1, 2]}` |
| `DATETIME` / `TIMESTAMP` | ISO-8601 standart zaman damgası | `'2026-10-29T14:30:00.000Z'` |
| `UUID` | Kriptografik benzersiz tanımlayıcı | `'f47ac10b-58cc-4372-a567-0e02b2c3d479'` |

---

## 3. Hızlı Başlangıç

### Kurulum
Depoyu klonlayın veya projenize bağımlılık olarak ekleyin:

```bash
git clone https://github.com/aliyabuz25/OctoSQL.git
cd OctoSQL
npm install
```

### Veritabanı Sunucusunu (Daemon) Başlatma
Veritabanı sunucusunu arka plan servisi olarak çalıştırın:

```bash
# NPM script ile
npm start

# Veya dahili CLI ile
./bin/octosql.js start
```

Sunucu varsayılan olarak **8421** portunda ayağa kalkar:
- **REST / Sürücü Endpoint:** `http://127.0.0.1:8421/api/query`
- **OctoAdminer Konsolu:** `http://127.0.0.1:8421/admin`

### Durum ve Sağlık Kontrolü
```bash
./bin/octosql.js status
```

---

## 4. SQL ve OctoSQLX Sözdizimi Karşılaştırması

OctoSQL, alışık olduğunuz standart ANSI SQL komutları ile daha esnek OctoSQLX komutlarını aynı veritabanı üzerinde yan yana çalıştırabilir:

### Veri Sorgulama (Select / Fetch)
```sql
-- ANSI SQL
SELECT id, slug, status FROM pages WHERE status = 'published' ORDER BY id ASC LIMIT 5 OFFSET 0;

-- OctoSQLX
FETCH id, slug, status FROM pages FILTER status = 'published' SORT id ASC RANGE 5 SKIP 0;
```

### Veri Ekleme (Insert / Store)
```sql
-- ANSI SQL
INSERT INTO locales (code, name, isDefault) VALUES ('tr', 'Türkçe', true);

-- OctoSQLX (Doğrudan JSON nesnesi ile)
STORE IN locales OBJECT {"code": "tr", "name": "Türkçe", "isDefault": true};
```

### Veri Güncelleme (Update / Mutate)
```sql
-- ANSI SQL
UPDATE pages SET status = 'draft' WHERE id = 'page-contact';

-- OctoSQLX
MUTATE pages SET status = 'draft' FILTER id = 'page-contact';
```

### Veri Silme (Delete / Purge)
```sql
-- ANSI SQL
DELETE FROM pages WHERE status = 'archived';

-- OctoSQLX
PURGE FROM pages FILTER status = 'archived';
```

### Tablo Tanımlama (Create / Spawn)
```sql
-- ANSI SQL
CREATE TABLE IF NOT EXISTS audit_logs (id UUID PRIMARY KEY, event TEXT, createdAt DATETIME);

-- OctoSQLX
SPAWN TABLE audit_logs WITH (id UUID PRIMARY KEY, event TEXT, createdAt DATETIME);
```

---

## 5. Node.js Projelerinden Bağlantı ve Kullanım

OctoSQL, `mysql2` veya `pg` paketleri ile birebir uyumlu bir bağlantı arayüzü sunar:

```javascript
const { createPool } = require('octosql');

// 1. Standart SQL Bağlantı Havuzu (Connection Pool)
const db = createPool({
  host: '127.0.0.1',
  port: 8421,
  database: 'octosql_db',
  connectionLimit: 10
});

// 2. Dizi Parçalama (Array Destructuring) ve ? ile Güvenli Parametre Bağlama
async function getActivePages() {
  const [rows, fields] = await db.query(
    'SELECT id, slug, translations FROM pages WHERE status = ? LIMIT 10',
    ['published']
  );
  return rows;
}

// 3. Prepared Statement ile Veri Ekleme
async function createPage(pageData) {
  const [result] = await db.execute(
    'INSERT INTO pages (id, slug, template, status, translations, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    [pageData.id, pageData.slug, 'standard', 'published', pageData.translations, new Date().toISOString()]
  );
  return result.insertId;
}

// 4. Tranzaksiyon Yönetimi (Atomik İşlemler)
async function performTransaction() {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('UPDATE locales SET isDefault = ?', [false]);
    await conn.execute('UPDATE locales SET isDefault = ? WHERE code = ?', [true, 'tr']);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
```

Daha fazla framework (Express, Fastify, Next.js, NestJS) ve TypeScript örneği için **[CONNECTING.md](CONNECTING.md)** dosyasına bakabilirsiniz.

---

## 6. Depolama Formatı ve Dosya Yapısı

Veriler SQLite benzeri yapılandırılmış yerel dosyalarda saklanır:

```text
octosql/
├── bin/
│   └── octosql.js             # Komut satırı aracı
├── data/
│   ├── *.osql                 # AES-256-GCM ile şifrelenmiş tablo verileri
│   ├── *.owal                 # Yazma günlüğü (Write-Ahead Logging)
│   └── security_audit.log     # Güvenlik duvarı engelleme günlüğü
├── lib/
│   ├── client.js              # createPool ve createConnection SQL sürücüsü
│   ├── engine.js              # ANSI SQL & OctoSQLX sorgu mühərriki
│   ├── storage.js             # .osql disk okuma/yazma motoru
│   ├── cache.js               # Redis ve bellek içi önbellek yöneticisi
│   ├── crypto.js              # AES-256-GCM şifreleme ve UUID yardımcıları
│   └── firewall.js            # Sistem IP kontrolü middleware
├── views/
│   └── studio.ejs             # OctoAdminer legacy yönetim konsolu
├── daemon.js                  # Sunucu başlatıcı dosya
├── Dockerfile                 # Konteyner tanımlaması
├── docker-compose.yml         # OctoSQL + Redis orkestrasyonu
├── README.md                  # Bu belge
└── CONNECTING.md              # Node.js entegrasyon kılavuzu
```

---

## 7. Test Paketini Çalıştırma

Tüm motor ve sürücü testleri tek komutla koşturulabilir:

```bash
npm test
```

Test çıktısı:
```text
--- Starting OctoSQL Engine Unit Tests ---
1. Testing CREATE TABLE...
2. Testing INSERT INTO...
3. Testing SELECT...
✓ SQL SELECT passed, rows: 2
4. Testing OctoSQLX FETCH...
✓ OctoSQLX FETCH passed
5. Testing OctoSQLX MUTATE...
✓ OctoSQLX MUTATE passed
6. Testing OctoSQLX PURGE...
✓ OctoSQLX PURGE passed
7. Testing System IP Firewall...
✓ IP Firewall validation passed
--- All OctoSQL Unit Tests Passed Successfully! ---

--- Testing SQL-Style Connection Methods End-to-End ---
1. Testing createConnection with URI...
✓ Connected & Ping OK (10ms)
2. Testing standard SQL query with array destructuring...
✓ Retrieved 2 rows, first page ID: page-home
✓ Fields metadata: [ 'id', 'slug', 'status' ]
3. Testing execute with parameter binding (? placeholder)...
✓ Prepared statement INSERT & SELECT verified
✓ Cleanup DELETE verified
4. Testing Transactions (beginTransaction, commit)...
✓ Transactions (BEGIN / COMMIT) verified
5. Testing Connection Pool (createPool)...
✓ Pool query returned total pages: 4
✓ Pool getConnection & release verified
--- All SQL Connection Method Tests Passed Successfully! ---
```

---

## 8. Docker ile Dağıtım

Tek bir komutla Redis entegrasyonlu olarak konteyner ortamında ayağa kaldırılabilir:

```bash
docker-compose up -d
```

---

## 9. Lisans ve Telif Hakkı

OctoSQL açık kaynaklı bir yazılımdır ve **MIT Lisansı** altında lisanslanmıştır.  
Telif Hakkı &copy; 2026 Ali Yabuz. Tüm hakları saklıdır.
