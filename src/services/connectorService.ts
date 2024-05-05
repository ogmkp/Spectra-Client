import { WebSocket } from 'ws';
import { DataTypes, IFormattedData } from './formattingService';
import { dialog } from 'electron';

const INGEST_SERVER_URL = "ws://localhost:5100/ingest";

interface Team {
  name: string,
  tricode: string,
  url: string
}

export class ConnectorService {
    private OBS_NAME = "";
    private GROUP_CODE = "";
    private LEFT_TEAM: Team = {
        name: '',
        tricode: '',
        url: ''
    };
    private RIGHT_TEAM: Team = {
        name: '',
        tricode: '',
        url: ''
    };

    private enabled = false;
    private unreachable = false;
    private ws!: WebSocket;
    private win!: Electron.Main.BrowserWindow;

    private static instance: ConnectorService;

    private constructor() { }

    public static getInstance(): ConnectorService {
        if (ConnectorService.instance == null) ConnectorService.instance = new ConnectorService();
        return ConnectorService.instance;
    }

    handleAuthProcess(obsName: string, groupCode: string, leftTeam: Team, rightTeam: Team, win: Electron.Main.BrowserWindow) {
        this.OBS_NAME = obsName;
        this.GROUP_CODE = groupCode;
        this.LEFT_TEAM = leftTeam;
        this.RIGHT_TEAM = rightTeam;
        this.win = win;

        this.ws = new WebSocket(INGEST_SERVER_URL);
        this.ws.once('open', () => {
            this.ws.send(JSON.stringify({ type: DataTypes.AUTH, playerName: this.OBS_NAME, groupCode: this.GROUP_CODE, leftTeam: this.LEFT_TEAM, rightTeam: this.RIGHT_TEAM}))
        });
        this.ws.once('message', (msg) => {
            const json = JSON.parse(msg.toString());

            if (json.type === DataTypes.AUTH) {
                if (json.value === true) {
                    console.log('Authentication successful!');
                    this.win.setTitle(`Spectra Client | Connected with Group ID: ${this.GROUP_CODE}`);
                    this.enabled = true;
                    this.websocketSetup();
                } else {
                    console.log('Authentication failed!');
                    this.win.setTitle(`Spectra Client | Connection failed, invalid data`);
                    this.enabled = false;
                    this.ws?.terminate();

                    dialog.showMessageBoxSync(win, {
                        title: "Spectra Client - Error",
                        message: "Inputted data was invalid!",
                        type: "error"
                    });
                }
            }
        });

        this.ws.on('close', () => {
            console.log('Connection to spectra server closed');
            if (this.unreachable === true) {
                this.win.setTitle(`Spectra Client | Connection failed, server not reachable`);

                dialog.showMessageBoxSync(win, {
                    title: "Spectra Client - Error",
                    message: "Spectra server not reachable!",
                    type: "error"
                });
            } else {
                this.win.setTitle(`Spectra Client | Connection closed`);
            }
            this.enabled = false;
            this.ws?.terminate();
        });

        this.ws.on('error', (e: any) => {
            console.log('Failed connection to spectra server - is it up?');
            if (e.code === "ECONNREFUSED") {
                this.win.setTitle(`Spectra Client | Connection failed, server not reachable`);
                this.unreachable = true;
            } else {
                this.win.setTitle(`Spectra Client | Connection failed`);
            }
            console.log(e);
        });
    }


    private websocketSetup() {
        this.ws.on('message', (msg) => {
            const json = JSON.parse(msg.toString());
            console.log(json);
        });
    }

    sendToIngest(formatted: IFormattedData) {
        if (this.enabled) {
            const toSend = { playerName: this.OBS_NAME, groupCode: this.GROUP_CODE, ...formatted };
            this.ws.send(JSON.stringify(toSend));
        }
    }
}