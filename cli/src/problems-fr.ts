import type { ProblemTexts } from "./problem-text.js";

const CONNEXION = "Lancez ajs-cloud login";

const NON_CONSTRUCTIBLE_RAISON =
  "Un déploiement demande un Dockerfile, un projet AntelopeJS ou une app Node avec un package.json.";
const NON_CONSTRUCTIBLE_CORRECTIFS = [
  "Ajoutez un Dockerfile, ou un package.json avec un script start",
  "Ou lancez la commande depuis le dossier de l’app elle-même",
];

export const FR: ProblemTexts = {
  not_authenticated: {
    title: "Vous n’êtes pas connecté",
    fixes: [`${CONNEXION}, puis relancez la commande`],
  },
  api_url_mismatch: {
    title: "Votre session est liée à un autre point d’accès de l’API",
    reason:
      "La session enregistrée n’est jamais envoyée à un point d’accès qui ne l’a pas émise.",
    fixes: ["Lancez ajs-cloud login --api-url <url> pour vous y connecter"],
  },
  project_not_linked: {
    title: "Ce dossier n’est associé à aucun projet",
    fixes: [
      "Lancez ajs-cloud deploy pour en créer un",
      "Ou lancez ajs-cloud link <projet> pour utiliser un projet existant",
    ],
  },
  workspace_mismatch: {
    title: "Ce dossier est associé à un autre espace de travail",
    reason:
      "La session de cette machine est celle d’un autre espace de travail.",
    fixes: [
      `${CONNEXION} et approuvez l’espace de travail du dossier`,
      "Ou relancez ajs-cloud link <projet>",
    ],
  },
  invalid_project_config: {
    title: "L’association .antelope/cloud.json n’est pas valide",
    fixes: ["Corrigez-la, ou supprimez-la et lancez ajs-cloud link <projet>"],
  },
  unknown_project: {
    title: "Aucun projet nommé « {detail} » dans cet espace de travail",
    fixes: [
      "Vérifiez le nom dans la console",
      "Ou lancez ajs-cloud deploy pour créer le projet",
    ],
  },
  unknown_service: {
    title: "Le projet n’a aucun service nommé « {detail} »",
    fixes: ["Lancez ajs-cloud status pour lister ses services"],
  },
  unlinkable_service: {
    title: "Le projet n’a aucun service nommé « {detail} »",
    reason: "Sans --service, link attend les services api et app d’un starter.",
    fixes: [
      "Passez --service <nom>=<chemin> pour chaque service de ce dossier",
    ],
  },
  outside_project: {
    title: "Ce dossier est hors du projet associé",
    fixes: ["Lancez la commande depuis le dossier du projet"],
  },
  service_path_not_found: {
    title: "Aucun service associé ne se trouve dans ce dossier",
    fixes: [
      "Lancez la commande depuis le dossier d’un service",
      "Ou nommez le service : ajs-cloud deploy <service>",
    ],
  },
  ambiguous_service_path: {
    title: "Plusieurs services associés se trouvent dans ce dossier",
    fixes: ["Nommez le service : ajs-cloud deploy <service>"],
  },
  invalid_service_path: {
    title: "Valeur --service invalide « {detail} »",
    reason: "Un service s’associe sous la forme <nom>=<chemin>.",
    fixes: ["Passez-le ainsi : --service api=apps/api"],
  },
  invalid_service_dockerfile: {
    title: "Valeur --dockerfile invalide « {detail} »",
    reason:
      "Un Dockerfile se donne sous la forme <service>=<chemin>, pour un service que --service associe.",
    fixes: ["Passez-le ainsi : --dockerfile app=docker/app.Dockerfile"],
  },
  service_path_outside_project: {
    title: "Le chemin de service « {detail} » est hors du dossier du projet",
    fixes: ["Indiquez un chemin dans le dossier du projet, comme apps/api"],
  },
  project_has_no_environment: {
    title: "Le projet n’a aucun environnement où déployer",
    fixes: ["Vérifiez le projet dans la console"],
  },
  rollback_revision_unavailable: {
    title:
      "Aucune révision antérieure de {detail} ne permet de revenir en arrière",
    fixes: ["Lancez ajs-cloud status pour voir ce que le service exécute"],
  },
  device_code_expired: {
    title: "La demande de connexion a expiré avant d’être approuvée",
    fixes: [`${CONNEXION} à nouveau`],
  },
  invalid_api_url: {
    title: "URL de l’API invalide {detail}",
    reason:
      "L’URL de l’API est une URL http(s) sans identifiants, paramètres ni fragment.",
    fixes: ["Passez-la ainsi : --api-url https://api.antelopejs.cloud"],
  },
  invalid_open_url: {
    title: "Ouverture de {detail} refusée",
    reason: "Seules les pages web sont ouvertes.",
  },
  invalid_timeout: {
    title: "--timeout invalide « {detail} »",
    reason: "Le délai est un nombre de minutes.",
    fixes: ["Passez-le ainsi : --timeout 30"],
  },
  invalid_port: {
    title: "Port invalide « {detail} »",
    reason: "Un port est un nombre entier de 1 à 65535.",
    fixes: ["Passez-le ainsi : --port 3000"],
  },
  invalid_project_slug: {
    title: "Nom de projet invalide « {detail} »",
    reason:
      "Un nom de projet compte au moins 2 minuscules, chiffres ou tirets.",
    fixes: ["Passez-le ainsi : --project mon-app"],
  },
  invalid_service_name: {
    title: "Nom de service invalide « {detail} »",
    reason: "Un nom de service se compose de minuscules, chiffres et tirets.",
    fixes: ["Nommez-le comme web ou api"],
  },
  unknown_region: {
    title: "Région inconnue « {detail} »",
    fixes: ["Passez l’une des régions ci-dessous avec --region"],
  },
  project_slug_taken: {
    title: "Le projet {detail} existe déjà dans cet espace de travail",
    reason:
      "--yes ne déploie jamais sur un projet existant sans qu’on le lui demande.",
    fixes: [
      "Passez --project {detail} pour y déployer, ou --project avec un autre nom",
      "Ou lancez d’abord ajs-cloud link {detail}",
    ],
  },
  project_creation_forbidden: {
    title:
      "Votre rôle ne permet pas de créer de projet dans cet espace de travail",
    fixes: [
      "Demandez à un administrateur de l’espace de travail",
      "Ou lancez ajs-cloud link <projet> pour déployer sur un projet existant",
    ],
  },
  unsupported_source: {
    title: "Ce dossier ne peut pas être construit",
    reason: NON_CONSTRUCTIBLE_RAISON,
    fixes: NON_CONSTRUCTIBLE_CORRECTIFS,
  },
  workspace_not_ready: {
    title: "Votre espace de travail est toujours en préparation",
    reason: "Rien n’a été créé.",
    fixes: [
      "Relancez ajs-cloud deploy dans quelques minutes",
      "Ou consultez l’espace de travail dans la console",
    ],
  },
  workspace_blocked: {
    title: "Votre espace de travail ne peut pas encore déployer",
    reason: "Il demande une intervention : {detail}.",
    fixes: ["Ouvrez la console pour en voir la cause, ou contactez le support"],
  },
  workspace_closed: {
    title: "Cet espace de travail a été supprimé ou résilié",
    reason: "Il ne peut plus déployer.",
    fixes: [`${CONNEXION} et approuvez un autre espace de travail`],
  },
  deployment_failed: {
    title: "Le déploiement de {detail} a échoué",
    fixes: [
      "Lancez ajs-cloud logs {detail} pour en voir la cause",
      "Ou ouvrez la page du déploiement ci-dessous",
    ],
  },
  deployment_cancelled: {
    title: "Le déploiement de {detail} a été annulé",
    fixes: ["Lancez ajs-cloud deploy {detail} pour en démarrer un autre"],
  },
  deployment_stream_ended: {
    title: "Suivi du déploiement de {detail} perdu",
    reason: "Il continue sur la plateforme.",
    fixes: ["Lancez ajs-cloud status pour le vérifier"],
  },
  deployment_timeout: {
    title: "Attente du déploiement de {detail} interrompue",
    reason: "Le déploiement continue sur la plateforme.",
    fixes: [
      "Lancez ajs-cloud status pour le vérifier",
      "Ou attendez plus longtemps avec --timeout <minutes>",
    ],
  },
  log_stream_error: {
    title: "Le flux de logs a échoué",
    reason: "{detail}",
  },
  invalid_log_event: {
    title: "L’API a envoyé une ligne de log illisible pour le CLI",
    fixes: ["Mettez à jour ajs-cloud, puis relancez la commande"],
  },
  invalid_api_response: {
    title: "L’API a envoyé une réponse illisible pour le CLI",
    fixes: ["Mettez à jour ajs-cloud, puis relancez la commande"],
  },
  network_error: {
    title: "Impossible de joindre AntelopeJS Cloud",
    reason: "Aucune réponse de {detail}.",
    fixes: [
      "Vérifiez votre connexion, puis relancez la commande",
      "Ou passez un autre point d’accès avec --api-url",
    ],
  },
  "api.invalidSlug": {
    title: "Le nom du projet n’est pas valide",
    reason:
      "Un nom de projet compte au moins 2 minuscules, chiffres ou tirets.",
  },
  "api.slugTaken": {
    title: "Un projet porte déjà ce nom",
    fixes: [
      "Passez --project avec un autre nom",
      "Ou lancez ajs-cloud link <projet> pour déployer sur le projet existant",
    ],
  },
  "api.projectLimit": {
    title: "L’espace de travail a atteint sa limite de projets",
    fixes: [
      "Changez de forfait",
      "Ou lancez ajs-cloud link <projet> pour déployer sur un projet existant",
    ],
  },
  "api.serviceLimit": {
    title: "L’environnement de production a atteint sa limite de services",
    fixes: ["Retirez un service, ou changez de forfait"],
  },
  "api.hostnameLimit": {
    title: "L’espace de travail a atteint sa limite de noms d’hôte publics",
    fixes: ["Retirez un service public, ou changez de forfait"],
  },
  "api.invalidServiceName": {
    title: "Le nom du service n’est pas valide",
    reason: "Un nom de service se compose de minuscules, chiffres et tirets.",
  },
  "api.serviceNameTaken": {
    title: "Un service porte déjà ce nom",
    fixes: ["Nommez le service autrement"],
  },
  "api.unbuildable": {
    title: "Ce dossier ne peut pas être construit",
    reason: NON_CONSTRUCTIBLE_RAISON,
    fixes: NON_CONSTRUCTIBLE_CORRECTIFS,
  },
  "api.missingStartScript": {
    title: "package.json n’a pas de script start",
    reason:
      "Sans Dockerfile, la plateforme démarre une app Node avec son script start.",
    fixes: [
      'Ajoutez un script start à package.json, comme "start": "node server.js"',
      'Pour un site statique, servez son build : "start": "npx serve dist"',
      "Ou ajoutez un Dockerfile",
    ],
  },
  "api.monorepoUnsupported": {
    title: "Un monorepo ne peut pas être construit sans Dockerfile",
    reason: "Le dossier est un espace de travail de plusieurs paquets.",
    fixes: ["Ajoutez un Dockerfile qui construit et démarre l’app"],
  },
  "api.plainVariableLimit": {
    title: "Le service contient plus de {limit} variables en clair",
    fixes: [
      "Passez certaines variables en secret dans la console",
      "Ou supprimez celles que l’app ne lit plus",
    ],
  },
  "api.plainValueTooLong": {
    title: "La variable en clair {key} dépasse {limit} caractères",
    fixes: [
      "Passez-la en secret dans la console pour garder une valeur plus longue",
    ],
  },
  "api.nodeVersionUnsupported": {
    title:
      "Aucune version de Node.js prise en charge ne correspond à {requested}",
    reason: "Versions prises en charge : {supported}.",
    fixes: [
      "Demandez une version prise en charge dans package.json (engines.node)",
      "Ou ajoutez un Dockerfile avec la version de Node.js qu’il vous faut",
    ],
  },
  "api.sourceTooLarge": {
    title: "Le dossier est trop volumineux pour être déployé",
    fixes: [
      "Listez ce dont le build n’a pas besoin dans un .cloudignore, comme les sorties de build ou les données de test",
    ],
  },
  "api.lfsUnsupported": {
    title: "Les fichiers Git LFS ne sont pas encore pris en charge",
    fixes: [
      "Ajoutez un Dockerfile qui les récupère",
      "Ou stockez ces fichiers ailleurs",
    ],
  },
  "api.unreadableSource": {
    title: "L’API n’a pas pu lire la source envoyée",
    reason:
      "L’archive est illisible, ou contient des entrées que la plateforme refuse.",
    fixes: [
      "Relancez ajs-cloud deploy",
      "Ou contactez le support si cela se reproduit",
    ],
  },
  "api.submodulesUnsupported": {
    title: "Les sous-modules Git ne sont pas pris en charge",
    reason: "L’envoi ne transporte jamais ce vers quoi pointe un sous-module.",
    fixes: [
      "Copiez les fichiers du sous-module dans le dossier, ou installez-le comme paquet",
      "Puis supprimez .gitmodules",
    ],
  },
  "api.infraUnavailable": {
    title: "La plateforme de déploiement est indisponible pour le moment",
    reason: "Le dossier reste associé.",
    fixes: ["Relancez ajs-cloud deploy plus tard"],
  },
  "api.workspaceNotReady": {
    title: "Votre espace de travail est encore en préparation",
    reason: "Cela prend environ une minute après sa création.",
    fixes: ["Relancez ajs-cloud deploy d’ici peu"],
  },
  "api.projectGone": {
    title: "Le projet associé n’existe plus",
    fixes: [
      "Lancez ajs-cloud link <projet> pour en associer un autre",
      "Ou supprimez .antelope/cloud.json et lancez ajs-cloud deploy pour en créer un",
    ],
  },
  "api.serviceGone": {
    title: "Le service n’existe plus",
    fixes: ["Lancez ajs-cloud status pour lister les services du projet"],
  },
  "api.deploymentInProgress": {
    title: "Un déploiement est déjà en cours pour ce service",
    fixes: ["Suivez-le avec ajs-cloud status, puis réessayez"],
  },
  "api.nothingDeployed": {
    title: "Rien n’a encore été déployé sur ce service",
    fixes: ["Lancez d’abord ajs-cloud deploy"],
  },
  "api.plan": {
    title: "Votre forfait actuel n’inclut pas cette opération",
    fixes: ["Changez de forfait dans la console"],
  },
  "api.sessionExpired": {
    title: "Votre session a expiré ou a été révoquée",
    fixes: [`${CONNEXION} à nouveau`],
  },
  "api.permission": {
    title: "Vous n’avez pas l’autorisation d’effectuer cette opération",
    fixes: ["Demandez à un administrateur de l’espace de travail"],
  },
  "api.quota": {
    title: "Un quota de l’espace de travail a été atteint",
    fixes: ["Consultez la consommation de l’espace de travail dans la console"],
  },
  "api.serverError": {
    title: "AntelopeJS Cloud a rencontré un problème en traitant la requête",
    fixes: ["Réessayez dans un instant"],
  },
  "api.refused": {
    title: "L’API a refusé la requête",
  },
};
