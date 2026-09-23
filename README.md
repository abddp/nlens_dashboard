# Nlens Dashboard 📊

Dashboard d'Analytics et Métriques SaaS pour la plateforme Nealens.

---

## 🚀 Démarrage Rapide

### 1. Prérequis
- **Python 3.10+**
- **Redis Server** (en local ou distant sur le port `6379`)

---

### 2. Démarrer le Serveur Django

```powershell
python manage.py runserver 8002
```
Le dashboard est accessible sur : [http://127.0.0.1:8002/](http://127.0.0.1:8002/)

---

### 3. Démarrer Celery (Worker & Beat)

> [!NOTE]
> **Sous Windows**, Celery ne supporte pas le mode `prefork` natif Linux. On utilise donc le pool de threads **`--pool=threads`** avec une concurrence adaptée (I/O bound pour les requêtes HTTP NealensQL et Redis).

#### Option A : Deux terminaux distincts (Recommandé)

**Terminal 1 — Worker Celery :**
```powershell
celery -A core worker -l info -Q nlens_dashboard_queue --pool=threads --concurrency=4
```

**Terminal 2 — Scheduler Celery Beat :**
```powershell
celery -A core beat -l info
```

---

#### Option B : Terminal unique combiné (Mode Développement)

Lance le Worker et le planificateur Beat simultanément dans la même console :
```powershell
celery -A core worker -l info -B -Q nlens_dashboard_queue --pool=threads --concurrency=4
```

---

#### Option C : Déclenchement manuel immédiat (Test du Cache)

Pour pré-calculer et remplir immédiatement le cache Redis sans attendre la planification horaire de Beat :
```powershell
python manage.py shell -c "from main.tasks import sync_all_kpis_task; sync_all_kpis_task()"
```

---

## 🏗️ Architecture Cache Redis & Celery

### ⚙️ Fonctionnement du Cache : Double Stratégie

Le système utilise une combinaison de **Cache-Aside (À la demande)** et de **Pre-warming (Arrière-plan)** pour garantir des temps de chargement ultra-rapides et une haute disponibilité :

1. **À la demande (*Cache-Aside / Lazy Loading*)** :
   - Lorsqu'un utilisateur consulte une métrique sur le dashboard, l'API vérifie d'abord si la clé existe dans Redis.
   - **Cache HIT ⚡** : Les données sont immédiatement servies depuis la RAM en moins de 2ms (zéro requête backend).
   - **Cache MISS 💨** : Si le cache est vide ou expiré, l'API exécute la requête live vers le backend Nealens, renvoie les données à l'utilisateur et les enregistre automatiquement dans Redis avec un TTL de 2 heures (`7200s`).

2. **En arrière-plan (*Background Pre-warming avec Celery Beat*)** :
   - Toutes les heures, Celery Beat déclenche la tâche `sync_all_kpis_task`.
   - Les 21 métriques clés sont pré-calculées pour les périodes standard (`7d`, `30d`, `month`, `year`) et stockées dans Redis avant même qu'un utilisateur n'ouvre la page.

| Élément | Configuration | Description |
| :--- | :--- | :--- |
| **Base Redis dédiée** | `redis://127.0.0.1:6379/2` (DB 2) | Isolation totale par rapport au backend central (`store_builder` sur DB 1) |
| **Queue Celery** | `nlens_dashboard_queue` | Empêche tout conflit de tâches entre les workers des différents projets |
| **Fréquence Celery Beat** | Toutes les **1 heure** (`3600s`) | Pré-calcule les 21 KPIs sur `7d`, `30d`, `month`, `year` |
| **TTL du Cache Redis** | **2 heures** (`7200s`) | Garantit que le cache reste toujours valide entre deux passages de Beat |
| **Format des clés** | `nlens_dashboard:analytics:kpi:{kpi}:range_{since}_to_{until}:granularity_{granularity}` | Clés explicites, standardisées et sans collision |

---

## 🔐 Authentification Interne

- **Middleware** : Protection automatique de toutes les vues (`InternalAuthMiddleware`).
- **Endpoints REST Auth** :
  - `POST /api/auth/login/` : Connexion JSON et initialisation de session.
  - `POST /api/auth/logout/` : Révocation du token et purge de session.
  - `GET /api/auth/me/` : Vérification du profil actif.
- **Profil Sidebar** : Dropup dynamique avec avatar, nom, email et déconnexion.
