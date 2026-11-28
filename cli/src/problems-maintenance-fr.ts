import type { ProblemTexts } from "./problem-text.js";

const REGLE_FENETRE =
  "Une fenêtre de maintenance s’ouvre un jour de la semaine (monday à sunday), à une heure pleine de 0 à 23, pour 1 à 4 heures, lues dans un fuseau horaire IANA comme Europe/Brussels.";

/** La fenêtre de maintenance d’une base de données gérée : ses erreurs d’usage et ses refus. */
export const MAINTENANCE_FR: ProblemTexts = {
  invalid_maintenance_day: {
    title: "Valeur --day invalide « {detail} »",
    reason: REGLE_FENETRE,
    fixes: ["Passez un jour de la semaine, par exemple --day sunday"],
  },
  invalid_maintenance_start: {
    title: "Valeur --start invalide « {detail} »",
    reason: REGLE_FENETRE,
    fixes: [
      "Passez l’heure d’ouverture de la fenêtre, par exemple --start 2 pour 02:00",
    ],
  },
  invalid_maintenance_hours: {
    title: "Valeur --hours invalide « {detail} »",
    reason: REGLE_FENETRE,
    fixes: ["Passez la durée de la fenêtre, par exemple --hours 3"],
  },
  invalid_maintenance_zone: {
    title: "Fuseau horaire inconnu « {detail} »",
    reason: REGLE_FENETRE,
    fixes: [
      "Passez un fuseau horaire IANA, par exemple --zone Europe/Brussels",
    ],
  },
  not_a_database: {
    title: "{detail} n’est pas une base de données gérée",
    reason: "Seule une base de données gérée a une fenêtre de maintenance.",
    fixes: ["Lancez ajs-cloud status pour voir les services du projet"],
  },
  "api.invalidMaintenanceWindow": {
    title: "L’API a refusé la fenêtre de maintenance",
    reason: REGLE_FENETRE,
  },
  "api.unknownTimeZone": {
    title: "L’API ne connaît aucun fuseau horaire de ce nom",
    fixes: [
      "Passez un fuseau horaire IANA, par exemple --zone Europe/Brussels",
    ],
  },
  "api.maintenanceOwnerOnly": {
    title:
      "Seul le propriétaire de l’espace de travail peut modifier une fenêtre de maintenance",
    reason:
      "Les membres qui gèrent la base de données peuvent lire sa fenêtre, pas la choisir.",
    fixes: ["Demandez au propriétaire de l’espace de travail de la modifier"],
  },
  "api.maintenancePlanLocked": {
    title: "Votre offre suit la fenêtre de maintenance de la plateforme",
    reason:
      "Sur Free, chaque base de données est maintenue le dimanche de 02:00 à 05:00, heure de Europe/Brussels.",
    fixes: [
      "Passez l’espace de travail à une offre payante pour choisir une fenêtre",
    ],
  },
};
