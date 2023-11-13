//@ts-check
debugger;
import { client as gradio } from "@gradio/client";

const app_reference = 'manu-sapiens/gradio-api-test'; //'tomsoderlund/rest-api-with-gradio';
const options = { "hf_token": "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" };//{hf_token} Not needed for a public space, which is the case here.

//@ts-ignore
const app = await gradio(app_reference, options);
const config = app.config;
const root = app.config.root;
const root_url = app.config.root_url;
const app_id = app.config.app_id;
const skip_queue = !app.config.enable_queue;
const space_id = app.config.space_id;
const jwt = app.config.jwt;

debugger;
const view_api = await app.view_api();
console.warn(`huggingface API returned:\n ${JSON.stringify(view_api)}`);

const result = await predict("/predict", ["This is a test"]);
console.warn(result);

async function predict(endpoint, data, event_data = null)
{
    debugger;
    if (endpoint != '/predict') 
    {
        throw new Error('endpoint must be /predict');
    }


    const app = await submit(data, event_data, jwt, skip_queue);

    try
    {
        const result = await new Promise((resolve, reject) =>
        {
            app
                .on("data", (d) =>
                {
                    resolve(d);
                })
                .on("status", (status) =>
                {
                    if (status.stage === "error")
                    {
                        reject(status);
                    }
                });
        });

        app.destroy();
        return result;
    } catch (error)
    {
        app.destroy();
        throw error;
    }
}


async function submit(data, event_data, jwt, skip_queue = false)
{
    let payload;
    let complete = false;
    const listener_map = {};

    const _endpoint = "/predict";

    const _payload = await handleBlob(_endpoint, data);

    let websocket;

    payload = { data: _payload || [], event_data };


    if (skip_queue)
    {
        await processImmediateCall(_endpoint, payload);
    } else
    {
        await processQueueCall(_endpoint, payload, "wss", jwt);
    }


    return {
        on(eventType, listener)
        {
            const listeners = listener_map[eventType] || [];
            listener_map[eventType] = listeners;
            listeners.push(listener);
            return this;
        },
        off(eventType, listener)
        {
            let listeners = listener_map[eventType] || [];
            listeners = listeners.filter((l) => l !== listener);
            listener_map[eventType] = listeners;
            return this;
        },
        async cancel()
        {
            const _status = { stage: "complete", queue: false };

            //@ts-ignore
            complete = _status;
            fireEvent("status", { ..._status });
            if (websocket && websocket.readyState === 0)
            {
                websocket.addEventListener("open", () =>
                {
                    websocket.close();
                });
            } else
            {
                websocket.close();
            }
            try
            {
                await fetch(
                    `${http_protocol}//${host + config.path}/reset`,
                    {
                        headers: { "Content-Type": "application/json" },
                        method: "POST",
                        body: JSON.stringify({ session_hash }),
                    }
                );
            } catch (e)
            {
                console.warn(
                    "The `/reset` endpoint could not be called. Subsequent endpoint results may be unreliable."
                );
            }
        },
        destroy()
        {
            for (const eventType in listener_map)
            {
                listener_map[eventType].forEach((fn) =>
                {
                    this.off(eventType, fn);
                });
            }
        },
    };

}

async function handleBlob(_endpoint, data)
{
    const response = await handle_blob(
        `${http_protocol}//${host + config.path}`,
        data,
        api.unnamed_endpoints[0],
        hf_token
    );
    return transform_files
        ? transform_output(response.data, api.unnamed_endpoints[0], config.root, config.root_url)
        : response.data;
}

async function processImmediateCall(_endpoint, payload)
{
    fireEvent("status", { stage: "pending", queue: false });
    const [output, status_code] = await post_data(
        `${http_protocol}//${host + config.path}/run${_endpoint}`,
        { ...payload, session_hash },
        hf_token
    );
    if (status_code == 200)
    {
        fireEvent("data", { data: output.data });
        fireEvent("status", {
            stage: "complete",
            eta: output.average_duration,
            queue: false,
        });
    } else
    {
        fireEvent("status", { stage: "error", message: output.error, queue: false });
    }
}

async function processQueueCall(_endpoint, payload, ws_protocol = "wss", jwt = null)
{
    fireEvent("status", { stage: "pending", queue: true });
    const url = new URL(`${ws_protocol}://${host}${config.path}/queue/join`);
    if (jwt)
    {
        url.searchParams.set("__sign", jwt);
    }
    const websocket = new WebSocket(url);
    websocket.onclose = (evt) =>
    {
        if (!evt.wasClean)
        {
            fireEvent("status", {
                stage: "error",
                message: BROKEN_CONNECTION_MSG,
                queue: true,
            });
        }
    };
    websocket.onmessage = function (event)
    {
        const _data = JSON.parse(event.data);
        const { type, status, data } = handle_message(
            _data,
            last_status[0]
        );
        if (type === "update" && status && !complete)
        {
            fireEvent("status", { ...status });
            if (status.stage === "error")
            {
                websocket.close();
            }
        } else if (type === "hash")
        {
            websocket.send(JSON.stringify({ session_hash }));
        } else if (type === "data")
        {
            websocket.send(JSON.stringify({ ...payload, session_hash }));
        } else if (type === "complete")
        {
            complete = status;
        } else if (type === "generating")
        {
            fireEvent("status", { ...status, stage: status.stage, queue: true });
        }
        if (data)
        {
            fireEvent("data", {
                data: transform_files
                    ? transform_output(data.data, api.unnamed_endpoints[0], config.root, config.root_url)
                    : data.data,
            });
            if (complete)
            {
                fireEvent("status", { ...complete, stage: status.stage, queue: true });
                websocket.close();
            }
        }
    };
    if (semiver(config.version || "2.0.0", "3.6") < 0)
    {
        addEventListener("open", () =>
            websocket.send(JSON.stringify({ hash: session_hash }))
        );
    }
}

function fireEvent(eventType, eventData)
{
    const listeners = listener_map[eventType] || [];
    listeners.forEach((listener) => listener(eventData));
}

async function handle_blob(endpoint, data, api_info, token)
{
    const blob_refs = await walk_and_store_blobs(data, undefined, [], true, api_info);

    const processedData = await Promise.all(
        blob_refs.map(async ({ path, blob, data, type }) =>
        {
            if (blob)
            {
                const file_url = (await upload_files(endpoint, [blob], token)).files[0];
                return { path, file_url, type };
            } else
            {
                return { path, base64: data, type };
            }
        })
    );

    processedData.forEach(({ path, file_url, base64, type }) =>
    {
        if (base64)
        {
            update_object(data, base64, path);
        } else if (type === "Gallery")
        {
            update_object(data, file_url, path);
        } else if (file_url)
        {
            const o = {
                is_file: true,
                name: `${file_url}`,
                data: null
                // orig_name: "file.csv"
            };
            update_object(data, o, path);
        }
    });

    return data;
}

function skipQueue(id, config) 
{
    return (
        !(config?.dependencies?.[id]?.queue === null
            ? config.enable_queue
            : config?.dependencies?.[id]?.queue) || false
    );
}