import { app as electronApp } from 'electron';
import { overwolf } from '@overwolf/ow-electron'
import { ConnectorService } from './connectorService';
import { setPlayerName } from '../main';
import { DataTypes, FormattingService, IFormattedData, IFormattedRoundInfo, IFormattedScore } from './formattingService';
import log from 'electron-log';

const app = electronApp as overwolf.OverwolfApp;
const VALORANT_ID = 21640;
let enabled = false;

export class GameEventsService {
  private gepApi!: overwolf.packages.OverwolfGameEventPackage;
  private valorantId: number = VALORANT_ID;
  private isFirstDetection: boolean = true;
  private connService = ConnectorService.getInstance();
  private formattingService = FormattingService.getInstance();
  public currRoundNumber: number = 0;
  private win: any;

  constructor() {
    this.registerOverwolfPackageManager();
  }

  public registerGame(gepGamesId: number) {
    this.valorantId = gepGamesId;
  }

  public registerWindow(win: any) {
    this.win = win;
  }

  public async setRequiredFeaturesValorant() {
    // https://overwolf.github.io/api/live-game-data/supported-games/valorant
    await this.gepApi.setRequiredFeatures(VALORANT_ID, ["match_info", "me"]);
  }

  private registerOverwolfPackageManager() {
    app.overwolf.packages.on('ready', (e, packageName, version) => {
      if (packageName !== 'gep') {
        return;
      }
      log.info(`GEP version ${version} ready!`);
      this.win!.setTitle(`Spectra Client | Ready (GEP: ${version})`);

      this.onGameEventsPackageReady();
    });
  }

  private async onGameEventsPackageReady() {
    this.gepApi = app.overwolf.packages.gep;

    this.gepApi.removeAllListeners();

    this.gepApi.on('game-detected', async (e, gameId, name, gameInfo) => {
      log.info(`Game detected: ${gameId} - ${name}`);
      if (!(this.valorantId === gameId)) {
        log.info("Game not Valorant - ignoring");
        return;
      }
      log.info("Game IS Valorant - enabling");
      if (this.isFirstDetection) {
        this.isFirstDetection = false;
      } else {
        this.win!.setTitle(`Spectra Client | Valorant re-detected - Ready`);
      }

      e.enable();
      this.setRequiredFeaturesValorant();
      enabled = true;
    });

    this.gepApi.on('new-info-update', (e, gameId, ...args) => {
      if (enabled) {
        for (const data of args) {
          try {
            this.processInfoUpdate(data);
          } catch (e) {
            log.error("Info update error: ", e);
          }
        }
      }
    });

    this.gepApi.on('new-game-event', (e, gameId, ...args) => {
      if (enabled) {
        for (const data of args) {
          try {
            this.processGameUpdate(data);
          } catch (e) {
            log.error("Game update error: ", e);
          }
        }
      }
    });

    this.gepApi.on('error', (e, gameId, error, ...args) => {
      log.error("GEP Error: ", error);
      enabled = false;
    });
  }

  processInfoUpdate(data: any) {
    if (data.gameId !== VALORANT_ID) return;

    if (data.key.includes("scoreboard")) {

      const value = JSON.parse(data.value);
      if (value.name == undefined || value.name == "") return;
      const formatted: IFormattedData = this.formattingService.formatScoreboardData(value);
      this.connService.sendToIngest(formatted);
      return;

    } else if (data.key.includes("roster")) {

      const value = JSON.parse(data.value);
      if (value.name == undefined || value.name == "") return;
      const formatted: IFormattedData = this.formattingService.formatRosterData(value, data.key);
      this.connService.sendToIngest(formatted);
      return;

    }

    let formatted: IFormattedData;
    let toSend: IFormattedData;
    switch (data.key) {

      case "health":
        // Nothing yet, sadly
        break;

      case "kill_feed":
        const value = JSON.parse(data.value);
        formatted = this.formattingService.formatKillfeedData(value);
        this.connService.sendToIngest(formatted);
        break;

      case "observing":
        toSend = { type: DataTypes.OBSERVING, data: data.value }
        this.connService.sendToIngest(toSend);
        break;

      case "round_number":
        this.currRoundNumber = +data.value;
        break;

      case "round_phase":
        formatted = this.formattingService.formatRoundData(data.value, this.currRoundNumber);
        this.connService.sendToIngest(formatted);

        if ((formatted.data as IFormattedRoundInfo).roundPhase === "game_end") {
          this.connService.handleMatchEnd();
        }

        break;

      case "match_score":
        toSend = { type: DataTypes.SCORE, data: JSON.parse(data.value) as IFormattedScore }
        this.connService.sendToIngest(toSend);
        break;

      case "game_mode":
        toSend = { type: DataTypes.GAME_MODE, data: JSON.parse(data.value).mode }
        this.connService.sendToIngest(toSend);
        break;

      case "map":
        // Why do we do this? The TS enum on the server side does not like "Infinity"
        // as one of its members because it counts as a numeric name :)
        if (data.value === "Infinity") {
          data.value = "Infinityy";
        }

        toSend = { type: DataTypes.MAP, data: data.value }
        this.connService.sendToIngest(toSend);
        break;

      case "player_name":
        log.info(`Detected player name: ${data.value}`);
        setPlayerName(data.value);
        break;

      case "team":
      case "match_outcome":
      case "pseudo_match_id":
      case "player_id":
      case "region":
        // Irrelevant, ignore
        break;

      default:
        log.info("Unhandled info update:", data);
        break;
    }
  }

  processGameUpdate(data: any) {

    let toSend: IFormattedData;
    switch (data.key) {
      // I do not know why we are getting a duplicate of kill feeds here now
      case "kill_feed":
        break;

      case "match_start":
        toSend = { type: DataTypes.MATCH_START, data: true };
        this.connService.sendToIngest(toSend);
        break;

      case "spike_planted":
        toSend = { type: DataTypes.SPIKE_PLANTED, data: true };
        this.connService.sendToIngest(toSend);
        break;

      case "spike_detonated":
        toSend = { type: DataTypes.SPIKE_DETONATED, data: true };
        this.connService.sendToIngest(toSend);
        break;

      case "spike_defused":
        toSend = { type: DataTypes.SPIKE_DEFUSED, data: true };
        this.connService.sendToIngest(toSend);
        break;

      case "match_end":
        // Kill connection
        this.connService.handleMatchEnd();
        break;

      default:
        log.info("Unhandled game update:", data);
        break;
    }
  }

}
