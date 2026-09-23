from django.core.management.base import BaseCommand
from main.services import clear_kpi_cache
from main.tasks import sync_all_kpis_task


class Command(BaseCommand):
    help = "Invalide et supprime les clés de cache Redis associées aux KPIs du tableau de bord."

    def add_arguments(self, parser):
        parser.add_argument(
            "--kpi",
            type=str,
            help="Nom du KPI spécifique à invalider (ex: mrr, signups, paying-stores, churn, retention, etc.). Si omis, tous les KPIs sont invalidés.",
            default=None,
        )
        parser.add_argument(
            "--rebuild",
            action="store_true",
            help="Recalcule et réchauffe immédiatement le cache après invalidation.",
            default=False,
        )

    def handle(self, *args, **options):
        kpi_name = options["kpi"]
        rebuild = options["rebuild"]

        target_desc = f"du KPI '{kpi_name}'" if kpi_name else "de TOUS les KPIs"
        self.stdout.write(f"Suppression du cache Redis {target_desc}...")

        deleted_count = clear_kpi_cache(kpi_name)

        if deleted_count > 0:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Succès : {deleted_count} clé(s) de cache Redis supprimée(s) {target_desc}."
                )
            )
        else:
            self.stdout.write(
                self.style.WARNING(
                    f"Aucune clé de cache trouvée {target_desc}."
                )
            )

        if rebuild:
            self.stdout.write("Réchauffement immédiat du cache en cours...")
            res = sync_all_kpis_task()
            synced_count = res["synced_count"]
            duration = res["duration_seconds"]
            self.stdout.write(
                self.style.SUCCESS(
                    f"Cache réchauffé avec succès : {synced_count} métriques recalculées en {duration}s."
                )
            )
