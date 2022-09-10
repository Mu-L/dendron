import {
  ConfigUtils,
  CONSTANTS,
  IntermediateDendronConfig,
  Theme,
} from "@dendronhq/common-all";
import {
  batch,
  createLogger,
  ideSlice,
  Provider,
  setLogLevel,
} from "@dendronhq/common-frontend";
import "antd/dist/antd.css";
import type { AppProps } from "next/app";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ThemeSwitcherProvider } from "react-css-theme-switcher";
import { useDendronGATracking } from "../components/DendronGATracking";
import DendronLayout from "../components/DendronLayout";
import { DendronRef } from "../components/DendronRef";
import DendronProvider from "../context/DendronProvider";
import { combinedStore, useCombinedDispatch } from "../features";
import { browserEngineSlice } from "../features/engine";
import { useIFrameHeightAdjuster } from "../hooks/useIFrameHeightAdjuster";
import "../public/assets-dendron/css/light.css";
import "../styles/scss/main.scss";
import { getLogLevel } from "../utils/etc";
import { fetchConfig, fetchNotes, fetchTreeMenu } from "../utils/fetchers";
import { useDendronRouter } from "../utils/hooks";
import { getAssetUrl } from "../utils/links";
import { NoteData } from "../utils/types";

const themes: { [key in Theme]: string } = {
  dark: getAssetUrl(`/assets-dendron/css/dark.css`),
  light: getAssetUrl(`/assets-dendron/css/light.css`),
  custom: getAssetUrl(`/themes/${CONSTANTS.CUSTOM_THEME_CSS}`),
};

function AppContainer(appProps: AppProps) {
  const { config } = appProps.pageProps as {
    config: IntermediateDendronConfig;
  };

  const logger = createLogger("AppContainer");
  useEffect(() => {
    const logLevel = getLogLevel();
    setLogLevel(logLevel);
  }, []);

  const router = useRouter();

  const defaultTheme = ConfigUtils.getPublishing(config).theme || Theme.LIGHT;
  logger.info({ ctx: "enter", defaultTheme });
  if (router.pathname === "/refs/[id]") {
    logger.info({ appProps });
    return (
      <Provider store={combinedStore}>
        <ThemeSwitcherProvider themeMap={themes} defaultTheme={defaultTheme}>
          <DendronRef body={appProps.pageProps.body} />
        </ThemeSwitcherProvider>
      </Provider>
    );
  }

  return (
    <Provider store={combinedStore}>
      <ThemeSwitcherProvider themeMap={themes} defaultTheme={defaultTheme}>
        <DendronApp {...appProps} />
      </ThemeSwitcherProvider>
    </Provider>
  );
}

function DendronApp({ Component, pageProps }: AppProps) {
  const [noteData, setNoteData] = useState<NoteData>();
  const logger = createLogger("App");
  const dendronRouter = useDendronRouter();
  const dispatch = useCombinedDispatch();
  useDendronGATracking();
  useIFrameHeightAdjuster();

  useEffect(() => {
    (async () => {
      const data = await fetchTreeMenu();
      dispatch(ideSlice.actions.setTree(data));
      logger.info({ ctx: "fetchTree:got-data", data });
    })();
  }, []);

  useEffect(() => {
    (async () => {
      logger.info({ ctx: "fetchNotes:pre" });
      const data = await fetchNotes();
      logger.info({ ctx: "fetchNotes:got-data" });
      setNoteData(data);
      batch(() => {
        dispatch(browserEngineSlice.actions.setNotes(data.notes));
        dispatch(browserEngineSlice.actions.setNoteIndex(data.noteIndex));
      });
      const config = await fetchConfig();
      logger.info({ ctx: "fetchConfig:got-data" });
      dispatch(browserEngineSlice.actions.setConfig(config));
    })();
  }, []);

  logger.info({ ctx: "render" });

  return (
    <DendronProvider>
      <DendronLayout
        {...noteData}
        noteIndex={pageProps.noteIndex}
        dendronRouter={dendronRouter}
      >
        <Head>
          <link rel="icon" href="/favicon.ico" />
        </Head>
        <Component
          {...pageProps}
          notes={noteData}
          dendronRouter={dendronRouter}
        />
      </DendronLayout>
    </DendronProvider>
  );
}

export default AppContainer;
